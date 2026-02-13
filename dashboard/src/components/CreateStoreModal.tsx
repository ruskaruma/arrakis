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
  { id: 'beauty', label: 'Beauty', desc: 'Skincare, perfumes, and soaps' },
  { id: 'sports', label: 'Sports', desc: 'Training gear and equipment' },
  { id: 'books', label: 'Books', desc: 'Literature and reference texts' },
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
    <div className="fixed inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Create New Store</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">Configure your WooCommerce store.</p>
        </div>

        <div className="px-6 pb-5 space-y-4">
          {/* Store Name */}
          <div>
            <label htmlFor="store-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Store Name <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              id="store-name"
              type="text"
              maxLength={64}
              placeholder="My Awesome Store"
              value={storeName}
              onChange={e => setStoreName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border-strong)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-lg focus:border-[#d4a843]/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Engine */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Engine</label>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-[#d4a843] bg-[#d4a843]/10 cursor-default">
                <div className="w-8 h-8 rounded-lg bg-[#d4a843]/20 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#d4a843]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">WooCommerce</p>
                  <p className="text-[11px] text-[var(--text-muted)]">WordPress + WooCommerce + HPOS</p>
                </div>
                <div className="w-4 h-4 rounded-full border-2 border-[#d4a843] flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#d4a843]" />
                </div>
              </div>

              <div className="relative flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] cursor-not-allowed opacity-60">
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-input)] flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-muted)]">MedusaJS</p>
                  <p className="text-[11px] text-[var(--text-dim)]">Headless commerce platform</p>
                </div>
                <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-input)] rounded-full">
                  Q2 2026
                </span>
              </div>
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Store Template</label>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  className={`p-3 rounded-lg text-left transition-all ${
                    template === t.id
                      ? 'border-2 border-[#d4a843] bg-[#d4a843]/10'
                      : 'border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <p className={`text-sm font-medium ${template === t.id ? 'text-[#d4a843]' : 'text-[var(--text-body)]'}`}>
                    {t.label}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--text-body)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-5 py-2 text-sm font-medium text-black bg-[#d4a843] rounded-lg hover:bg-[#c8992e] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'Create Store'}
          </button>
        </div>
      </div>
    </div>
  );
}
