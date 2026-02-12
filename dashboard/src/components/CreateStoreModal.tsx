import { useState } from 'react';
import { createStore } from '../api.ts';

interface CreateStoreModalProps {
  onClose: () => void;
  onCreated: () => void;
}

const TEMPLATES = [
  { id: 'general', label: 'General', desc: 'Default store with sample products' },
  { id: 'fashion', label: 'Fashion', desc: 'Clothing, robes, and accessories' },
  { id: 'food', label: 'Food & Drink', desc: 'Tea, coffee, and baked goods' },
  { id: 'electronics', label: 'Electronics', desc: 'Devices and tech gadgets' },
] as const;

export default function CreateStoreModal({ onClose, onCreated }: CreateStoreModalProps) {
  const [storeName, setStoreName] = useState('');
  const [template, setTemplate] = useState<string>('general');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      await createStore({
        engine: 'woocommerce',
        storeName: storeName.trim() || undefined,
        template,
      });
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create New Store</h2>
          <p className="text-sm text-gray-500 mt-1">Configure your WooCommerce store.</p>
        </div>

        <div className="px-6 pb-5 space-y-4">
          {/* Store Name */}
          <div>
            <label htmlFor="store-name" className="block text-xs font-medium text-gray-700 mb-1.5">
              Store Name <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="store-name"
              type="text"
              maxLength={64}
              placeholder="My Awesome Store"
              value={storeName}
              onChange={e => setStoreName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
            />
          </div>

          {/* Engine */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Engine</label>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-primary-500 bg-primary-50/50 cursor-default">
                <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">WooCommerce</p>
                  <p className="text-[11px] text-gray-500">WordPress + WooCommerce + HPOS</p>
                </div>
                <div className="w-4 h-4 rounded-full border-2 border-primary-500 flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-primary-500" />
                </div>
              </div>

              <div className="relative flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50 cursor-not-allowed opacity-60">
                <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-500">MedusaJS</p>
                  <p className="text-[11px] text-gray-400">Headless commerce platform</p>
                </div>
                <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-200 rounded-full">
                  Q2 2026
                </span>
              </div>
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Store Template</label>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    template === t.id
                      ? 'border-primary-500 bg-primary-50/50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className={`text-sm font-medium ${template === t.id ? 'text-primary-700' : 'text-gray-700'}`}>
                    {t.label}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'Create Store'}
          </button>
        </div>
      </div>
    </div>
  );
}
