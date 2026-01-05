import { GoogleGenAI, Type } from "@google/genai";
import { LocationState, PriceOption, UnitSystem } from "../types";

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

// Throttling mechanism
let requestQueue: Promise<any> = Promise.resolve();
const MIN_GAP = 1000; 

async function throttle() {
  const currentQueue = requestQueue;
  let resolver: (value?: any) => void;
  requestQueue = new Promise(resolve => { resolver = resolve; });
  await currentQueue;
  await new Promise(resolve => setTimeout(resolve, MIN_GAP));
  resolver!();
}

async function handleApiCall<T>(call: () => Promise<T>, retries = 2): Promise<T> {
  try {
    if (retries === 2) await throttle();
    return await call();
  } catch (error: any) {
    const status = error?.status || error?.error?.code;
    if ((status === 429 || status >= 500) && retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return handleApiCall(call, retries - 1);
    }
    throw new GeminiError(error?.message || "AI Service Error", status);
  }
}

function getAI() {
  // Directly accessing the string injected by Vite
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new GeminiError("API Key is missing. Please check your environment variables.", 401);
  }
  return new GoogleGenAI({ apiKey });
}

// Fix: Implement and export getCoordsFromLocation to resolve the missing import error in App.tsx
export async function getCoordsFromLocation(locationString: string): Promise<LocationState | null> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide the latitude and longitude for the location: "${locationString}". Return JSON only.`,
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
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        return { lat: data.lat, lng: data.lng };
      }
    } catch (e) {
      console.error("Failed to parse coordinates from Gemini response", e);
    }
    return null;
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
      contents: `Analyze: "${itemName}". Give name, emoji, and isVague (true if it needs a specific brand/type).`,
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
      model: 'gemini-3-pro-preview',
      contents: `Current prices for "${itemName}" near ${location.lat}, ${location.lng}. Major local supermarkets only.`,
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
      contents: `Nearest ${shopName} to ${location.lat}, ${location.lng}. Return BRANCH and DISTANCE in ${unit}.`,
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
      contents: `Price of "${itemName}" at ${shopName} near ${location.lat}, ${location.lng}. Number only.`,
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