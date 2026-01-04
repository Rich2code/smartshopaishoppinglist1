import { GoogleGenAI, Type } from "@google/genai";
import { LocationState, PriceOption, UnitSystem } from "../types";

/**
 * Custom error class for API-specific issues.
 */
export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

// Global request queue to prevent slamming the API and hitting rate limits
let requestQueue: Promise<any> = Promise.resolve();
const REQUEST_GAP = 1200; // 1.2s gap between starting requests

/**
 * Throttles execution to stay within rate limits.
 */
async function throttle() {
  const currentQueue = requestQueue;
  // resolver must accept an optional value to match the Promise resolve signature (value: any) => void
  let resolver: (value?: any) => void;
  requestQueue = new Promise(resolve => { resolver = resolve; });
  
  await currentQueue;
  // Wait a bit after the previous request started
  await new Promise(resolve => setTimeout(resolve, REQUEST_GAP));
  resolver!();
}

/**
 * Handles API calls with robust retry logic and exponential backoff.
 */
async function handleApiCall<T>(call: () => Promise<T>, retries = 3, backoff = 2500): Promise<T> {
  try {
    // Throttling to prevent 429s from concurrent calls
    if (retries === 3) await throttle();
    
    return await call();
  } catch (error: any) {
    const status = error?.status || error?.error?.code;
    const message = error?.message || "Unknown API error";

    // Handle 429 Rate Limit specifically with longer backoff
    if (status === 429 && retries > 0) {
      console.warn(`Rate limit hit. Waiting ${backoff}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return handleApiCall(call, retries - 1, backoff * 2);
    }

    // Handle transient server errors (500, 503, etc)
    if ((status >= 500 || status === 0) && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      return handleApiCall(call, retries - 1, backoff * 1.5);
    }

    // Specialized error messages
    if (status === 403) {
      throw new GeminiError("API Key permissions issue or Quota exceeded.", 403);
    }
    
    throw new GeminiError(message, status);
  }
}

/**
 * Gets a fresh instance of the AI client.
 */
function getAI() {
  // Use process.env.API_KEY directly as per guidelines
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
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
      contents: `Analyze this shopping item: "${itemName}".
      1. Use common sense. If specific (e.g. "whole milk"), isVague: FALSE. 
      2. If highly ambiguous (e.g. "bread"), isVague: TRUE.
      3. Provide a relevant emoji.`,
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
      contents: `Find top 3 cheapest major retailers for "${itemName}" near ${location.lat}, ${location.lng}. Only real physical stores.`,
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
    const unitPrompt = unitSystem === 'metric' ? "km" : "mi";
    
    // Updated to gemini-2.5-flash as Maps grounding is only supported in Gemini 2.5 series models
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Find the closest ${shopName} branch to coordinates ${location.lat}, ${location.lng}. 
      Give me a concise branch name for display (e.g. "Upminster Aldi" or "Romford Tesco") instead of a full address.
      Return the answer in this EXACT format only:
      BRANCH: [Simplified Branch Name]
      DISTANCE: [X ${unitPrompt}]`,
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
      branchName: branchMatch ? branchMatch[1].trim() : `${shopName} (Nearby)`,
      distance: distanceMatch ? distanceMatch[1].trim() : "Nearby"
    };
  });
}

export async function getCoordsFromLocation(location: string): Promise<LocationState | null> {
  return handleApiCall(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Latitude and longitude for "${location}".`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { lat: { type: Type.NUMBER }, lng: { type: Type.NUMBER } },
          required: ["lat", "lng"],
        },
      },
    });
    const data = JSON.parse(response.text || "{}");
    return data.lat ? { lat: data.lat, lng: data.lng, address: location } : null;
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
      contents: `Numerical price only for "${itemName}" at ${shopName} near ${location.lat}, ${location.lng}.`,
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
