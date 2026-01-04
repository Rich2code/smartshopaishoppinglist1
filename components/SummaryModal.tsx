
import React, { useEffect, useState } from 'react';
import { ShoppingItem, LocationState, UnitSystem } from '../types';
import { getPriceAtShop, getStoreBranchDetails } from '../services/geminiService';

interface Props {
  items: ShoppingItem[];
  location: LocationState;
  currencySymbol: string;
  distanceUnit: UnitSystem;
  maxDistance: number;
  cachedData: RankedShop[] | null;
  onCalculationDone: (ranked: RankedShop[]) => void;
  onClose: () => void;
}

export interface RankedShop {
  shopName: string;
  branchName: string;
  distance: string;
  numericDistance: number;
  totalPrice: number;
  weight: number;
  itemsAtBest: number;
  isClosest: boolean;
  isCheapest: boolean;
  isWithinPreference: boolean;
  receipt: Array<{ itemName: string, price: number, isCheapestHere: boolean }>;
  savingsDiff: Array<{ itemName: string, cheapestPrice: number, cheapestShop: string, bestShopPrice: number, difference: number }>;
  potentialSavings: number;
}

const SummaryModal: React.FC<Props> = ({ items, location, currencySymbol, distanceUnit, maxDistance, cachedData, onCalculationDone, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [rankedShops, setRankedShops] = useState<RankedShop[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  
  // By default, the strategy comparison is EXTENDED as requested
  const [showAlternatives, setShowAlternatives] = useState(true);
  
  // Detail accordions
  const [showReceipt, setShowReceipt] = useState(false);
  const [showCheapestPerStore, setShowCheapestPerStore] = useState(false);

  useEffect(() => {
    let timer: any;

    const updateProgressSmoothly = (target: number, duration: number = 600, callback?: () => void) => {
      const start = progress;
      const range = target - start;
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const p = Math.min(elapsed / duration, 1);
        const currentVal = Math.floor(start + range * p);
        setProgress(currentVal);
        if (p < 1) {
          timer = requestAnimationFrame(animate);
        } else if (callback) {
          callback();
        }
      };
      timer = requestAnimationFrame(animate);
    };

    if (cachedData) {
      // FAST MOCK LOADING
      setRankedShops(cachedData);
      updateProgressSmoothly(100, 800, () => {
        setTimeout(() => setLoading(false), 200);
      });
    } else {
      // REAL FULL CALCULATION
      const getNumericDistance = (distStr: string) => {
        const match = distStr.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : Infinity;
      };

      const calculateSummary = async () => {
        setLoading(true);
        setProgress(5);
        
        const readyItems = items.filter(i => i.status === 'ready');
        if (readyItems.length === 0) {
          setLoading(false);
          return;
        }

        const shopWeights: Record<string, number> = {};
        readyItems.forEach(item => {
          item.topOptions?.forEach((opt, idx) => {
            const weight = 3 - idx;
            shopWeights[opt.shop] = (shopWeights[opt.shop] || 0) + weight;
          });
        });

        const sortedCandidateShops = Object.entries(shopWeights)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(entry => ({ name: entry[0], weight: entry[1] }));

        let calculatedRanked: RankedShop[] = [];

        for (let sIdx = 0; sIdx < sortedCandidateShops.length; sIdx++) {
          const candidate = sortedCandidateShops[sIdx];
          const currentShopName = candidate.name;
          
          setProgress(Math.floor(20 + (sIdx * (80 / sortedCandidateShops.length))));

          const branchInfo = await getStoreBranchDetails(currentShopName, location, distanceUnit);
          const numericDist = getNumericDistance(branchInfo.distance);
          
          let shopTotal = 0;
          let itemsAtBestCount = 0;
          let shopPotentialSavings = 0;
          const shopReceipt: RankedShop['receipt'] = [];
          const shopDiffs: RankedShop['savingsDiff'] = [];

          for (let i = 0; i < readyItems.length; i++) {
            const item = readyItems[i];
            const absoluteCheapest = item.topOptions?.[0] || { price: 0, shop: "N/A" };
            const inTopOptions = item.topOptions?.find(o => o.shop === currentShopName);
            
            let priceAtThisShop: number;
            if (inTopOptions) {
              priceAtThisShop = inTopOptions.price;
            } else {
              priceAtThisShop = await getPriceAtShop(item.name, currentShopName, location);
            }

            shopTotal += priceAtThisShop;
            const isCheapestHere = currentShopName === absoluteCheapest.shop;
            if (isCheapestHere) itemsAtBestCount++;

            shopReceipt.push({
              itemName: item.name,
              price: priceAtThisShop,
              isCheapestHere
            });

            if (!isCheapestHere) {
              const d = priceAtThisShop - absoluteCheapest.price;
              if (d > 0.01) {
                shopPotentialSavings += d;
                shopDiffs.push({
                  itemName: item.name,
                  cheapestPrice: absoluteCheapest.price,
                  cheapestShop: absoluteCheapest.shop,
                  bestShopPrice: priceAtThisShop,
                  difference: d
                });
              }
            }
          }

          calculatedRanked.push({
            shopName: currentShopName,
            branchName: branchInfo.branchName,
            distance: branchInfo.distance,
            numericDistance: numericDist,
            totalPrice: shopTotal,
            weight: candidate.weight,
            itemsAtBest: itemsAtBestCount,
            isClosest: false,
            isCheapest: false,
            isWithinPreference: numericDist <= maxDistance,
            receipt: shopReceipt,
            savingsDiff: shopDiffs,
            potentialSavings: shopPotentialSavings
          });
        }

        calculatedRanked.sort((a, b) => {
          if (a.isWithinPreference && !b.isWithinPreference) return -1;
          if (!a.isWithinPreference && b.isWithinPreference) return 1;
          return a.totalPrice - b.totalPrice;
        });

        calculatedRanked = calculatedRanked.slice(0, 3);

        if (calculatedRanked.length > 0) {
          let minDist = Infinity;
          let closestIdx = -1;
          let minPrice = Infinity;
          let cheapestIdx = -1;

          calculatedRanked.forEach((shop, idx) => {
            if (shop.numericDistance < minDist) {
              minDist = shop.numericDistance;
              closestIdx = idx;
            }
            if (shop.totalPrice < minPrice) {
              minPrice = shop.totalPrice;
              cheapestIdx = idx;
            }
          });

          if (closestIdx !== -1) calculatedRanked[closestIdx].isClosest = true;
          if (cheapestIdx !== -1) calculatedRanked[cheapestIdx].isCheapest = true;
        }

        setRankedShops(calculatedRanked);
        onCalculationDone(calculatedRanked);
        setProgress(100);
        setTimeout(() => setLoading(false), 500);
      };

      calculateSummary();
    }

    return () => cancelAnimationFrame(timer);
  }, [items, location, distanceUnit, maxDistance, cachedData]);

  const currentStrategy = rankedShops[activeIndex];

  const handleOpenMaps = (query: string) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-10">
          <div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Strategy Dashboard</h2>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mt-1">Route Preference: {maxDistance}{distanceUnit === 'metric' ? 'km' : 'mi'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-50 dark:bg-slate-800 p-2 rounded-full">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90 absolute" viewBox="0 0 100 100">
                  <circle className="text-slate-100 dark:text-slate-800" strokeWidth="6" stroke="currentColor" fill="transparent" r="44" cx="50" cy="50" />
                  <circle 
                    className="text-indigo-600 transition-all duration-300" 
                    strokeWidth="6" 
                    strokeDasharray="276.46" 
                    strokeDashoffset={276.46 - (276.46 * progress) / 100} 
                    strokeLinecap="round" 
                    stroke="currentColor" 
                    fill="transparent" 
                    r="44" 
                    cx="50" 
                    cy="50" 
                  />
                </svg>
                <div className="text-3xl font-black text-slate-800 dark:text-slate-100">{progress}%</div>
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-bold animate-pulse tracking-wide text-center">
                {cachedData ? "Refreshing your routes..." : "Analyzing routes & local stock..."}
              </p>
            </div>
          ) : currentStrategy ? (
            <div className="space-y-6 animate-in fade-in duration-500">
              
              {/* Blue Recommendation Box - EXTENDED by default */}
              <div className="bg-indigo-600 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden transition-all duration-300">
                <div className="relative z-10">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="text-indigo-200 font-bold text-[10px] uppercase tracking-widest">Selected Store</p>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${currentStrategy.isWithinPreference ? 'bg-indigo-500' : 'bg-red-500/50'}`}>
                          {currentStrategy.distance}
                        </span>
                        {currentStrategy.isClosest && (
                          <span className="bg-emerald-500 text-white px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter">Closest</span>
                        )}
                        {currentStrategy.isCheapest && (
                          <span className="bg-amber-500 text-white px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter">Cheapest</span>
                        )}
                      </div>
                      <h3 className="text-2xl font-black mb-1 leading-tight truncate">{currentStrategy.branchName}</h3>
                      <button 
                        onClick={() => handleOpenMaps(currentStrategy.branchName)}
                        className="flex items-center gap-1.5 mt-2 bg-white/10 hover:bg-white/20 transition-colors px-3 py-1.5 rounded-xl text-xs font-bold border border-white/20"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                        Get Directions
                      </button>
                    </div>
                    {rankedShops.length > 1 && (
                      <button 
                        onClick={() => setShowAlternatives(!showAlternatives)}
                        className="bg-white/20 hover:bg-white/30 p-2 rounded-xl transition-colors backdrop-blur-sm ml-4 shrink-0"
                      >
                        {showAlternatives ? (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Top 3 Comparison - EXTENDED by default */}
                  {showAlternatives && rankedShops.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-2 animate-in slide-in-from-top-2">
                      <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Compare Strategy Options:</p>
                      <div className="flex flex-col gap-2">
                        {rankedShops.map((shop, idx) => (
                          <div key={shop.shopName} className="flex gap-2">
                            <button
                              onClick={() => setActiveIndex(idx)}
                              className={`flex-1 flex items-center justify-between p-3 rounded-2xl transition-all border-2 text-left ${idx === activeIndex ? 'bg-white text-indigo-700 border-white shadow-lg' : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`}
                            >
                              <div className="flex flex-col overflow-hidden">
                                <span className="font-bold text-sm truncate">{shop.branchName}</span>
                                <div className="flex gap-1 mt-0.5">
                                  <span className={`text-[9px] font-medium ${idx === activeIndex ? 'text-indigo-500' : 'opacity-75'}`}>{shop.distance}</span>
                                  {shop.isClosest && <span className={`text-[8px] font-black uppercase ${idx === activeIndex ? 'text-emerald-600' : 'text-emerald-300'}`}>Closest</span>}
                                  {shop.isCheapest && <span className={`text-[8px] font-black uppercase ${idx === activeIndex ? 'text-amber-600' : 'text-amber-300'}`}>Cheapest</span>}
                                </div>
                              </div>
                              <span className="font-mono text-xs font-black shrink-0">{currencySymbol}{shop.totalPrice.toFixed(2)}</span>
                            </button>
                            <button 
                              onClick={() => handleOpenMaps(shop.branchName)}
                              className={`p-3 rounded-2xl border-2 transition-all ${idx === activeIndex ? 'bg-white border-white text-indigo-600' : 'bg-white/10 border-white/20 text-white'}`}
                              title="Directions"
                            >
                              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-end mt-4">
                    <p className="text-indigo-100 text-sm leading-tight opacity-90">
                      Total projection for all items.
                    </p>
                    <p className="text-3xl font-black">{currencySymbol}{currentStrategy.totalPrice.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Trip Shopping List - Collapsed Detail */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                <button 
                  onClick={() => setShowReceipt(!showReceipt)}
                  className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 text-sm uppercase tracking-tighter">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth={2} /></svg>
                    Trip Shopping List
                  </span>
                  <span className="bg-white dark:bg-slate-700 p-1 rounded-full shadow-sm text-slate-400">
                    {showReceipt ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M20 12H4" /></svg> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 4v16m8-8H4" /></svg>}
                  </span>
                </button>
                {showReceipt && (
                  <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 space-y-3 animate-in slide-in-from-top-2">
                    {currentStrategy.receipt.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-slate-400 font-medium truncate pr-4">
                          {item.itemName} 
                          {item.isCheapestHere && <span className="ml-2 text-[10px] bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded font-bold uppercase">Best Deal</span>}
                        </span>
                        <span className="text-slate-800 dark:text-slate-200 font-mono shrink-0">{currencySymbol}{item.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Potential Savings Analysis */}
              {currentStrategy.savingsDiff.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                  <button 
                    onClick={() => setShowCheapestPerStore(!showCheapestPerStore)}
                    className="w-full flex items-center justify-between p-4 bg-orange-50 dark:bg-orange-900/10 hover:bg-orange-100 dark:hover:bg-orange-900/20 transition-colors"
                  >
                    <span className="font-bold text-orange-800 dark:text-orange-300 text-sm flex items-center gap-2 uppercase tracking-tighter">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Savings Trade-offs ({currentStrategy.savingsDiff.length} items)
                    </span>
                    <span className="bg-white dark:bg-slate-700 p-1 rounded-full shadow-sm text-orange-400">
                      {showCheapestPerStore ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M20 12H4" /></svg> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 4v16m8-8H4" /></svg>}
                    </span>
                  </button>
                  {showCheapestPerStore && (
                    <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 space-y-4 animate-in slide-in-from-top-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic font-medium">By selecting {currentStrategy.branchName}, you are paying <b>{currencySymbol}{currentStrategy.potentialSavings.toFixed(2)}</b> extra vs. multiple separate trips. Here are all items cheaper at other stores:</p>
                      {currentStrategy.savingsDiff.map((diff, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                          <div className="overflow-hidden">
                            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{diff.itemName}</p>
                            <p className="text-[10px] text-slate-500 uppercase font-black">Best at <span className="text-indigo-600 dark:text-indigo-400">{diff.cheapestShop}</span></p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-green-600 dark:text-green-400 text-sm">{currencySymbol}{diff.cheapestPrice.toFixed(2)}</p>
                            <p className="text-[10px] text-red-400 font-bold leading-none mt-0.5">+ {currencySymbol}{diff.difference.toFixed(2)} here</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          ) : null}
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-800">
          <button 
            onClick={onClose}
            className="w-full bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white font-black py-4 rounded-2xl transition-all duration-200 shadow-xl hover:scale-[1.02] active:scale-100"
          >
            Back to List
          </button>
        </div>
      </div>
    </div>
  );
};

export default SummaryModal;
