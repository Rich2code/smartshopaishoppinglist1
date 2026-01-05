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
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.isRateLimit = status === 429;
  }
}

// Stricter request queue to avoid 429 Quota Exceeded errors
let requestQueue: Promise<any> = Promise.resolve();
const BASE_DELAY = 3000; // Increased to 3 seconds for better free-tier stability

async function throttle() {
  const currentQueue = requestQueue;
  let resolver: (value?: any) => void;
  requestQueue = new Promise(resolve => { resolver = resolve; });
  await currentQueue;
  await new Promise(resolve => setTimeout(resolve, BASE_DELAY));
  resolver!();
}

async function handleApiCall<T>(call: () => Promise<T>, retries = 1): Promise<T> {
  try {
    await throttle();
    return await call();
  } catch (error: any) {
    console.error("Gemini API Error details:", error);
    
    const status = error?.status || error?.error?.code || (error?.message?.includes('429') ? 429 : 500);
    const message = error?.message || "";

    if (status === 429) {
      // Check if message implies daily quota vs per-minute rate limit
      const isDailyQuota = message.toLowerCase().includes("daily") || message.toLowerCase().includes("quota");
      
      if (retries > 0 && !isDailyQuota) {
        console.warn(`Rate limit hit. Retrying in 12s...`);
        await new Promise(r => setTimeout(r, 12000));
        return handleApiCall(call, retries - 1);
      }
      
      const friendlyMessage = isDailyQuota 
        ? "Daily API quota exhausted. Try again tomorrow." 
        : "Too many requests. Please wait 60 seconds.";
      
      throw new GeminiError(friendlyMessage, 429);
    }

    if (status >= 500 && retries > 0) {
      await new Promise(r => setTimeout(r, 4000));
      return handleApiCall(call, retries - 1);
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
  });
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
  });
}

export async function findTopPriceOptions(
  itemName: string, 
  location: LocationState
): Promise<PriceOption[]> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Find current prices for "${itemName}" near ${location.lat}, ${location.lng} in local stores. Return JSON array of objects with {shop, price, currency}.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              shop: { type: Type.STRING },
              price: { type: Type.NUMBER },
              currency: { type: Type.STRING },
            },
            required: ["shop", "price", "currency"],
          }
        },
      },
    });
    return JSON.parse(response.text || "[]");
  });
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
  });
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
      contents: `Price of "${itemName}" at ${shopName} near ${location.lat}, ${location.lng}. JSON: {price: number}.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { price: { type: Type.NUMBER } },
          required: ["price"],
        },
      },
    });
    const data = JSON.parse(response.text || "{}");
    return data.price || 0;
  });
}