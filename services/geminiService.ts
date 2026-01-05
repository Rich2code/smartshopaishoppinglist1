import { GoogleGenAI, Type } from "@google/genai";
import { LocationState, PriceOption, UnitSystem } from "../types";

// Explicit global type for process.env to satisfy TypeScript build
declare const process: {
  env: {
    API_KEY: string;
  };
};

export class GeminiError extends Error {
  status?: number;
  isRateLimit: boolean;
  isDaily: boolean;

  constructor(message: string, status?: number, isDaily: boolean = false) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.isRateLimit = status === 429;
    this.isDaily = isDaily;
  }
}

// Stricter request queue to avoid 429 errors
// Search grounding has very strict rate limits on the free tier.
let requestQueue: Promise<any> = Promise.resolve();
const BASE_DELAY = 4000; // 4 seconds base delay
const SEARCH_DELAY = 8000; // 8 seconds delay for search tools

async function throttle(isSearch: boolean = false) {
  const currentQueue = requestQueue;
  let resolver: (value?: any) => void;
  requestQueue = new Promise(resolve => { resolver = resolve; });
  await currentQueue;
  await new Promise(resolve => setTimeout(resolve, isSearch ? SEARCH_DELAY : BASE_DELAY));
  resolver!();
}

async function handleApiCall<T>(call: () => Promise<T>, isSearch: boolean = false, retries = 1): Promise<T> {
  try {
    await throttle(isSearch);
    return await call();
  } catch (error: any) {
    console.error("Gemini API Error details:", error);
    
    const status = error?.status || error?.error?.code || (error?.message?.includes('429') ? 429 : 500);
    const message = error?.message || "";

    if (status === 429) {
      // "Quota" in Google APIs often refers to RPM (minute limits), not just daily limits.
      // We only assume "Daily" if the message specifically mentions "daily" or "day".
      const isExplicitlyDaily = message.toLowerCase().includes("daily") || message.toLowerCase().includes("per day");
      
      if (retries > 0 && !isExplicitlyDaily) {
        console.warn(`Rate limit hit. Retrying with longer backoff...`);
        await new Promise(r => setTimeout(r, 15000));
        return handleApiCall(call, isSearch, retries - 1);
      }
      
      const friendlyMessage = isExplicitlyDaily 
        ? "Daily API limit reached. Try again in 24 hours." 
        : "Temporary rate limit reached. Please wait 60 seconds.";
      
      throw new GeminiError(friendlyMessage, 429, isExplicitlyDaily);
    }

    if (status >= 500 && retries > 0) {
      await new Promise(r => setTimeout(r, 5000));
      return handleApiCall(call, isSearch, retries - 1);
    }
    
    throw new GeminiError(message || "AI Service Error", status);
  }
}

function getAI() {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new GeminiError("API Key missing. Check environment variables.", 401);
  }
  return new GoogleGenAI({ apiKey });
}

export async function getCoordsFromLocation(locationString: string): Promise<LocationState | null> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Find lat/lng for: "${locationString}". Return JSON only.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lat: { type: Type.NUMBER },
            lng: { type: Type.NUMBER }
          },
          required: ["lat", "lng"],
        },
      },
    });
    
    try {
      const data = JSON.parse(response.text || "{}");
      return { lat: data.lat, lng: data.lng };
    } catch (e) {
      return null;
    }
  }, false);
}

export async function refineItem(itemName: string): Promise<{ 
  name: string; 
  emoji: string; 
  isVague: boolean; 
  options?: string[];
  example?: string;
}> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze grocery item: "${itemName}". Return JSON: {name, emoji, isVague, options[], example}. isVague=true if multiple types exist.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            emoji: { type: Type.STRING },
            isVague: { type: Type.BOOLEAN },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            example: { type: Type.STRING }
          },
          required: ["name", "emoji", "isVague"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  }, false);
}

export async function findTopPriceOptions(
  itemName: string, 
  location: LocationState
): Promise<PriceOption[]> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      // Guidelines: DO NOT set responseMimeType or responseSchema when using googleSearch.
      // Ask the model to format the text output instead.
      contents: `Find current prices for "${itemName}" near ${location.lat}, ${location.lng} in major local physical supermarkets. Return ONLY a JSON array of objects with {shop, price, currency}. Try to find at least 3 different shops if possible.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    
    const text = response.text || "[]";
    // Extract JSON array from text in case the model adds extra words
    const jsonMatch = text.match(/\[.*\]/s);
    try {
      return JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      console.error("Failed to parse search prices:", text);
      return [];
    }
  }, true);
}

export async function getStoreBranchDetails(
  shopName: string,
  location: LocationState,
  unitSystem: UnitSystem = 'metric'
): Promise<{ branchName: string; distance: string }> {
  return handleApiCall(async () => {
    const ai = getAI();
    const unit = unitSystem === 'metric' ? "km" : "mi";
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Nearest ${shopName} to ${location.lat}, ${location.lng}. Return BRANCH: [name] and DISTANCE: [value] ${unit}.`,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: { latLng: { latitude: location.lat, longitude: location.lng } }
        }
      },
    });

    const text = response.text || "";
    const branchMatch = text.match(/BRANCH:\s*(.*)/i);
    const distanceMatch = text.match(/DISTANCE:\s*(.*)/i);

    return {
      branchName: branchMatch ? branchMatch[1].trim() : `${shopName}`,
      distance: distanceMatch ? distanceMatch[1].trim() : "Nearby"
    };
  }, false);
}

export async function getPriceAtShop(
  itemName: string,
  shopName: string,
  location: LocationState
): Promise<number> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      // Guidelines: DO NOT set responseMimeType or responseSchema when using googleSearch.
      contents: `Exact current price of "${itemName}" at ${shopName} near ${location.lat}, ${location.lng}. Return ONLY the price as a number, e.g. 2.99.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const text = response.text || "0";
    const priceMatch = text.match(/\d+(\.\d+)?/);
    return priceMatch ? parseFloat(priceMatch[0]) : 0;
  }, true);
}