
export interface PriceOption {
  shop: string;
  price: number;
  currency: string;
}

export interface ShoppingItem {
  id: string;
  originalName: string;
  name: string;
  emoji: string;
  status: 'pending' | 'correcting' | 'vague' | 'searching' | 'ready' | 'error';
  options?: string[];
  example?: string;
  topOptions?: PriceOption[];
  cheapestShop?: string;
  price?: number;
  currency?: string;
  error?: string;
  isSelected?: boolean;
}

export interface SummaryData {
  bestShop: string;
  totalItems: number;
  itemsAtBestShop: number;
  potentialSavings: number;
  bestShopTotalPrice: number;
  allItemPricesAtBestShop: Array<{
    itemName: string;
    price: number;
    isCheapestHere: boolean;
  }>;
  priceDifferences: Array<{
    itemName: string;
    cheapestPrice: number;
    cheapestShop: string;
    bestShopPrice: number;
    difference: number;
  }>;
  otherShops: Array<{
    shopName: string;
    totalPrice: number;
    itemDetails: Array<{
      itemName: string;
      price: number;
    }>;
  }>;
}

export interface LocationState {
  lat: number;
  lng: number;
  address?: string;
}

export type Theme = 'light' | 'dark';
export type UnitSystem = 'metric' | 'imperial';

export interface AppSettings {
  theme: Theme;
  currency: string;
  distanceUnit: UnitSystem;
  maxDistance: number; // New: preference in distance units
  locationString?: string;
  manualLocation?: LocationState;
}
