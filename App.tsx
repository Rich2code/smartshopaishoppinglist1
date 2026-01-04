
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShoppingItem, LocationState, Theme, AppSettings, UnitSystem } from './types';
import { refineItem, findTopPriceOptions, getCoordsFromLocation, GeminiError } from './services/geminiService';
import ShoppingItemCard from './components/ShoppingItemCard';
import SummaryModal from './components/SummaryModal';

const App: React.FC = () => {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [location, setLocation] = useState<LocationState | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  
  // Track if items or settings have changed to invalidate cached results
  const [lastCalculationFingerprint, setLastCalculationFingerprint] = useState<string>('');
  const [cachedRankedShops, setCachedRankedShops] = useState<any[] | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    theme: 'light',
    currency: '£',
    distanceUnit: 'metric',
    maxDistance: 10,
    locationString: ''
  });
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // Generate a fingerprint of current state that affects pricing/routing
  const currentFingerprint = useMemo(() => {
    const readyItems = items.filter(i => i.status === 'ready').map(i => i.id + i.name).sort().join('|');
    const locKey = location ? `${location.lat.toFixed(4)},${location.lng.toFixed(4)}` : 'none';
    const manualLocKey = settings.manualLocation ? `${settings.manualLocation.lat.toFixed(4)},${settings.manualLocation.lng.toFixed(4)}` : 'none';
    return `${readyItems}-${locKey}-${manualLocKey}-${settings.maxDistance}-${settings.distanceUnit}`;
  }, [items, location, settings.manualLocation, settings.maxDistance, settings.distanceUnit]);

  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('bg-slate-950', 'text-slate-100');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.add('bg-slate-50', 'text-slate-900');
    }
  }, [settings.theme]);

  useEffect(() => {
    fetchCurrentLocation();
  }, []);

  const fetchCurrentLocation = () => {
    setLoadingLocation(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(loc);
          setLoadingLocation(false);
          setSettings(s => ({ ...s, locationString: 'Current GPS Location', manualLocation: loc }));
        },
        () => setLoadingLocation(false)
      );
    } else {
      setLoadingLocation(false);
    }
  };

  const processItem = async (id: string, name: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'correcting', error: undefined } : i));
    try {
      const refined = await refineItem(name);
      if (refined.isVague && refined.options) {
        setItems(prev => prev.map(i => i.id === id ? { 
          ...i, 
          name: refined.name, 
          emoji: refined.emoji, 
          status: 'vague',
          options: refined.options,
          example: refined.example
        } : i));
      } else {
        await continueWithItem(id, refined.name, refined.emoji);
      }
    } catch (error) {
      handleProcessingError(id, error);
    }
  };

  const continueWithItem = async (id: string, name: string, emoji: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, name, emoji, status: 'searching', error: undefined } : i));
    try {
      const currentLoc = settings.manualLocation || location;
      if (currentLoc) {
        const topOptions = await findTopPriceOptions(name, currentLoc);
        const cheapest = topOptions[0] || { shop: "Unknown", price: 0, currency: "£" };
        setItems(prev => prev.map(i => i.id === id ? { 
          ...i, 
          topOptions: topOptions,
          cheapestShop: cheapest.shop,
          price: cheapest.price,
          currency: cheapest.currency,
          status: 'ready' 
        } : i));
      } else {
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'ready' } : i));
      }
    } catch (error) {
      handleProcessingError(id, error);
    }
  };

  const handleProcessingError = (id: string, error: any) => {
    console.error("Processing error:", error);
    const errorMessage = error instanceof GeminiError ? error.message : "API Request failed. Try again.";
    setItems(prev => prev.map(i => i.id === id ? { 
      ...i, 
      status: 'error', 
      error: errorMessage 
    } : i));
  };

  const handleUpdateLocation = async () => {
    if (!settings.locationString || settings.locationString === 'Current GPS Location') return;
    setIsUpdatingLocation(true);
    try {
      const coords = await getCoordsFromLocation(settings.locationString);
      if (coords) {
        setSettings(s => ({ ...s, manualLocation: coords }));
        setLocation(coords);
      }
    } catch (e) {
      console.error("Location update failed", e);
    }
    setIsUpdatingLocation(false);
  };

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    const newItem: ShoppingItem = {
      id: Math.random().toString(36).substring(7),
      originalName: inputValue.trim(),
      name: inputValue.trim(),
      emoji: '🛒',
      status: 'pending'
    };
    setItems(prev => [...prev, newItem]);
    setInputValue('');
    processItem(newItem.id, newItem.originalName);
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const deleteItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));
  const deleteSelected = () => {
    if (window.confirm(`Delete ${selectedCount} selected items?`)) {
      setItems(prev => prev.filter(i => !i.isSelected));
      setSelectionMode(false);
    }
  };
  const deleteAll = () => {
    if (!isDeletingAll) {
      setIsDeletingAll(true);
      setTimeout(() => setIsDeletingAll(false), 3000);
      return;
    }
    setItems([]);
    setIsDeletingAll(false);
    setSelectionMode(false);
  };
  const toggleSelect = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, isSelected: !i.isSelected } : i));
  const handleToggleSelectAll = () => {
    const allSelected = items.every(i => i.isSelected);
    setItems(prev => prev.map(i => ({ ...i, isSelected: !allSelected })));
    setSelectionMode(true);
  };

  const selectedCount = items.filter(i => i.isSelected).length;
  const readyItemsCount = items.filter(i => i.status === 'ready').length;

  const handleSummaryResult = (ranked: any[]) => {
    setCachedRankedShops(ranked);
    setLastCalculationFingerprint(currentFingerprint);
  };

  return (
    <div className="min-h-screen transition-colors duration-300 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto flex flex-col px-4 pt-8 pb-32 md:pt-12">
        <header className="mb-8 flex flex-col items-center relative">
          <button onClick={() => setShowSettings(true)} className="absolute right-0 top-0 p-3 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors bg-white dark:bg-slate-800 rounded-full shadow-sm">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
          <h1 className="text-4xl font-black tracking-tighter flex items-center gap-2 text-slate-900 dark:text-slate-100">SmartShop<span className="text-indigo-600">.</span></h1>
          <p className="text-slate-400 dark:text-slate-500 font-medium text-sm uppercase tracking-widest mt-1">Minimalist Intelligence</p>
        </header>

        <form onSubmit={addItem} className="relative mb-6 group">
          <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="Add to list..." className="w-full bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-3xl py-5 px-8 text-lg focus:outline-none focus:border-indigo-500 transition-all shadow-sm group-hover:shadow-md text-slate-900 dark:text-slate-100" />
          <button type="submit" className="absolute right-3 top-3 bottom-3 bg-slate-900 dark:bg-indigo-600 text-white px-5 rounded-2xl hover:bg-indigo-600 transition-colors shadow-lg">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 4v16m8-8H4" /></svg>
          </button>
        </form>

        {items.length > 0 && (
          <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex items-center gap-4">
              <button onClick={handleToggleSelectAll} className="text-xs font-bold uppercase tracking-tighter text-slate-400 hover:text-indigo-600">
                {items.every(i => i.isSelected) ? 'Deselect' : 'Select All'}
              </button>
              {selectionMode && selectedCount > 0 && <button onClick={deleteSelected} className="text-xs font-bold text-red-500 uppercase tracking-tighter">Delete ({selectedCount})</button>}
            </div>
            <button onClick={deleteAll} className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${isDeletingAll ? 'bg-red-500 text-white animate-pulse' : 'text-slate-300 hover:text-red-400'}`}>
              {isDeletingAll ? 'Sure?' : 'Clear All'}
            </button>
          </div>
        )}

        <div className="flex-1 space-y-4 mb-8">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 opacity-10">
              <div className="text-8xl mb-6">🛒</div>
              <p className="text-xl font-black uppercase tracking-widest">Cart is empty</p>
            </div>
          ) : (
            items.map(item => (
              <ShoppingItemCard 
                key={item.id} 
                item={item} 
                selectionMode={selectionMode}
                currencySymbol={settings.currency}
                onDelete={deleteItem}
                onSelect={toggleSelect}
                onOptionPick={(id, name) => continueWithItem(id, name, item.emoji)}
                onRetry={(id) => processItem(id, item.originalName)}
              />
            ))
          )}
          <div ref={scrollRef} />
        </div>

        {items.length > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm px-4">
            <button onClick={() => setShowSummary(true)} disabled={readyItemsCount === 0} className={`w-full py-5 rounded-3xl font-black text-lg shadow-2xl flex items-center justify-center gap-3 transition-all transform active:scale-95 ${readyItemsCount > 0 ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}`}>
              {readyItemsCount < items.length ? <><div className="w-5 h-5 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>Comparing...</> : <><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>Strategy</>}
            </button>
          </div>
        )}

        {showSettings && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[70] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl p-8 border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600"><svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3} /></svg></button>
              </div>
              <div className="space-y-8">
                <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Location</label>
                   <div className="flex flex-col gap-3">
                    <input type="text" placeholder="City or Postcode..." className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-5 text-sm dark:text-white" value={settings.locationString} onChange={(e) => setSettings({...settings, locationString: e.target.value})} />
                    <button onClick={handleUpdateLocation} className="py-3 bg-indigo-600 text-white rounded-2xl text-xs font-bold hover:bg-indigo-700 transition-colors">Set Location</button>
                  </div>
                </div>

                <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Unit System</label>
                   <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <button onClick={() => setSettings({...settings, distanceUnit: 'metric'})} className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${settings.distanceUnit === 'metric' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>Metric (km)</button>
                    <button onClick={() => setSettings({...settings, distanceUnit: 'imperial'})} className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${settings.distanceUnit === 'imperial' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>Imperial (mi)</button>
                  </div>
                </div>

                <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Distance Preference</label>
                   <div className="space-y-2">
                     <input 
                       type="range" 
                       min="1" 
                       max="50" 
                       value={settings.maxDistance} 
                       onChange={(e) => setSettings({...settings, maxDistance: parseInt(e.target.value)})}
                       className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                     />
                     <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                       <span>Narrow (1{settings.distanceUnit === 'metric' ? 'km' : 'mi'})</span>
                       <span className="text-indigo-600 dark:text-indigo-400">{settings.maxDistance}{settings.distanceUnit === 'metric' ? 'km' : 'mi'}</span>
                       <span>Wide (50{settings.distanceUnit === 'metric' ? 'km' : 'mi'})</span>
                     </div>
                   </div>
                </div>

                <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Interface Theme</label>
                   <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <button onClick={() => setSettings({...settings, theme: 'light'})} className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${settings.theme === 'light' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>Light</button>
                    <button onClick={() => setSettings({...settings, theme: 'dark'})} className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${settings.theme === 'dark' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400'}`}>Dark</button>
                  </div>
                </div>

                <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Currency</label>
                   <select 
                     value={settings.currency} 
                     onChange={(e) => setSettings({...settings, currency: e.target.value})}
                     className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-3 px-4 text-xs font-bold dark:text-white"
                   >
                     <option value="£">GBP (£)</option>
                     <option value="$">USD ($)</option>
                     <option value="€">EUR (€)</option>
                   </select>
                </div>
              </div>
              <button onClick={() => setShowSettings(false)} className="w-full mt-10 bg-indigo-600 text-white py-5 rounded-3xl font-black text-lg hover:bg-indigo-700 transition-colors">Save Changes</button>
            </div>
          </div>
        )}

        {showSummary && (location || settings.manualLocation) && (
          <SummaryModal 
            items={items} 
            location={settings.manualLocation || location!} 
            currencySymbol={settings.currency} 
            distanceUnit={settings.distanceUnit} 
            maxDistance={settings.maxDistance}
            cachedData={lastCalculationFingerprint === currentFingerprint ? cachedRankedShops : null}
            onCalculationDone={handleSummaryResult}
            onClose={() => setShowSummary(false)} 
          />
        )}
      </div>
    </div>
  );
};

export default App;
