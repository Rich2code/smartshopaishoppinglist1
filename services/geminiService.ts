
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

/**
 * Handles API calls with basic retry logic and detailed error parsing.
 */
async function handleApiCall<T>(call: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await call();
  } catch (error: any) {
    const status = error?.status || error?.error?.code;
    const message = error?.message || "Unknown API error";

    // If it's a transient server error (500, 503, 504) and we have retries left, wait and try again.
    if ((status >= 500 || status === 0) && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
      return handleApiCall(call, retries - 1);
    }

    // Specialized error messages based on status codes
    if (status === 429) {
      throw new GeminiError("Rate limit reached. Please wait 60 seconds.", 429);
    }
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
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
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
      contents: `Find top 3 cheapest major retailers for "${itemName}" near ${location.lat}, ${location.lng}.`,
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
    
    // NOTE: Maps tool does NOT support responseMimeType or responseSchema.
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
    // Robust parsing for the requested format
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
      contents: `Coords for "${location}".`,
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
      contents: `Price of "${itemName}" at ${shopName} near ${location.lat}, ${location.lng}.`,
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
