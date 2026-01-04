
import React, { useState } from 'react';
import { ShoppingItem } from '../types';

interface Props {
  item: ShoppingItem;
  selectionMode: boolean;
  currencySymbol: string;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onOptionPick: (id: string, name: string) => void;
  onRetry: (id: string) => void;
}

const ShoppingItemCard: React.FC<Props> = ({ item, selectionMode, currencySymbol, onDelete, onSelect, onOptionPick, onRetry }) => {
  const [customValue, setCustomValue] = useState('');

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customValue.trim()) {
      onOptionPick(item.id, customValue.trim());
    }
  };

  const isError = item.status === 'error';

  return (
    <div className={`bg-white dark:bg-slate-800 p-4 rounded-xl border transition-all duration-200 shadow-sm flex flex-col gap-3 group 
      ${item.isSelected ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/30' : 
        isError ? 'border-red-500 bg-red-50/30 dark:bg-red-900/10 animate-pulse-subtle' : 'border-slate-200 dark:border-slate-700'}`}>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 overflow-hidden">
          {selectionMode && (
            <input 
              type="checkbox" 
              checked={!!item.isSelected}
              onChange={() => onSelect(item.id)}
              className="w-5 h-5 rounded border-slate-300 text-indigo-600"
            />
          )}
          <span className="text-2xl" role="img">
            {item.status === 'correcting' ? '🪄' : isError ? '⚠️' : item.emoji}
          </span>
          <div className="flex flex-col flex-1 overflow-hidden">
            <span className={`font-medium truncate ${item.status === 'correcting' ? 'text-slate-400 italic' : isError ? 'text-red-700 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
              {item.name}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              {item.status === 'searching' && (
                <span className="text-xs text-indigo-500 animate-pulse">Checking prices...</span>
              )}
              {isError && (
                <span className="text-[10px] font-bold text-red-500 uppercase tracking-tight break-words line-clamp-2">
                  {item.error || "Rate limit. Wait 60s."}
                </span>
              )}
              {item.status === 'ready' && item.cheapestShop && (
                <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded-full border border-transparent dark:border-slate-700">
                  <span className="font-semibold text-indigo-600">{item.cheapestShop}</span>: {currencySymbol}{item.price?.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isError && (
            <button 
              onClick={() => onRetry(item.id)}
              className="bg-red-500 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg hover:bg-red-600 active:scale-95"
            >
              Retry
            </button>
          )}
          <button 
            onClick={() => onDelete(item.id)}
            className="text-slate-400 hover:text-red-50 p-2 rounded-lg transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {item.status === 'vague' && (
        <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-lg border border-indigo-100 dark:border-indigo-800/40 space-y-4">
          <div>
            <p className="text-xs font-bold text-indigo-700 mb-2 uppercase tracking-tight">Be more specific:</p>
            <div className="flex flex-wrap gap-2">
              {item.options?.map(opt => (
                <button
                  key={opt}
                  onClick={() => onOptionPick(item.id, opt)}
                  className="text-xs bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-200"
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={handleCustomSubmit} className="flex gap-2">
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder={item.example || "e.g. Salt & Vinegar"}
              className="flex-1 bg-white dark:bg-slate-700 border border-indigo-200 rounded-lg py-1.5 px-3 text-xs"
            />
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Go</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ShoppingItemCard;
