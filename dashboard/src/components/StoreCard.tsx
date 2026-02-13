import { useState, useEffect, useRef } from 'react';
import type { Store, StoreEvent, StoreCredentials, StoreMetrics, Product } from '../api.ts';
import { deleteStore, retryStore, fetchStoreEvents, fetchStoreCredentials, fetchStoreMetrics, fetchProducts, createProduct, deleteProduct } from '../api.ts';
import { timeAgo, formatDuration } from '../utils.ts';
import { toast } from './Toast.tsx';

interface StoreCardProps {
  store: Store;
  onDeleted: () => void;
}

const PHASES = ['Pending', 'Provisioning', 'Configuring', 'Verifying', 'Ready'] as const;

const PHASE_STYLES: Record<string, string> = {
  Ready: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  Provisioning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  Configuring: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  Verifying: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  Pending: 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border)]',
  Failed: 'bg-red-500/15 text-red-400 border border-red-500/30',
  Deleting: 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border)]',
  Upgrading: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  RollingBack: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
};

const BORDER_ACCENT: Record<string, string> = {
  Ready: 'border-l-emerald-500/60',
  Provisioning: 'border-l-amber-500/60',
  Configuring: 'border-l-amber-500/60',
  Verifying: 'border-l-blue-500/60',
  Failed: 'border-l-red-500/60',
  Pending: 'border-l-[var(--border)]',
  Deleting: 'border-l-[var(--border)]',
  Upgrading: 'border-l-blue-500/60',
  RollingBack: 'border-l-amber-500/60',
};

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startedAt).getTime());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - new Date(startedAt).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="font-mono text-xs text-amber-400">{formatDuration(elapsed)}</span>;
}

function PhaseSteps({ currentPhase }: { currentPhase: string }) {
  const currentIndex = PHASES.indexOf(currentPhase as typeof PHASES[number]);
  const isFailed = currentPhase === 'Failed';
  const isDeleting = currentPhase === 'Deleting';

  if (isFailed || isDeleting) return null;

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => {
        const isComplete = currentIndex > i;
        const isCurrent = currentIndex === i;
        return (
          <div key={phase} className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                isComplete ? 'bg-emerald-500' :
                isCurrent ? 'bg-amber-400 animate-pulse-dot' :
                'bg-[var(--bg-input)]'
              }`}
              title={phase}
            />
            {i < PHASES.length - 1 && (
              <div className={`w-4 h-px ${isComplete ? 'bg-emerald-500/40' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function StoreCard({ store, onDeleted }: StoreCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [creds, setCreds] = useState<StoreCredentials | null>(null);
  const [showCreds, setShowCreds] = useState(false);
  const [metrics, setMetrics] = useState<StoreMetrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [showProducts, setShowProducts] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', imageUrl: '' });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStore(store.id);
      toast('info', `${store.storeName || store.id} teardown started`);
      onDeleted();
    } catch {
      setDeleteError('Failed to delete');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryStore(store.id);
      toast('info', `Retrying ${store.storeName || store.id}`);
      onDeleted();
    } catch {
      toast('error', 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  async function handleCopyUrl() {
    if (!store.url) return;
    await navigator.clipboard.writeText(store.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function loadProducts() {
    setProductsLoading(true);
    try {
      const data = await fetchProducts(store.id);
      setProducts(data);
    } catch {
      toast('error', 'Failed to load products');
    } finally {
      setProductsLoading(false);
    }
  }

  async function handleAddProduct() {
    if (!newProduct.name.trim()) return;
    setAddingProduct(true);
    try {
      const images = newProduct.imageUrl.trim()
        ? [{ src: newProduct.imageUrl.trim() }]
        : undefined;
      await createProduct(store.id, { name: newProduct.name.trim(), regular_price: newProduct.price || '0', images });
      setNewProduct({ name: '', price: '', imageUrl: '' });
      await loadProducts();
      toast('success', 'Product added');
    } catch {
      toast('error', 'Failed to add product');
    } finally {
      setAddingProduct(false);
    }
  }

  async function handleDeleteProduct(productId: number) {
    try {
      await deleteProduct(store.id, productId);
      setProducts(prev => prev.filter(p => p.id !== productId));
      toast('info', 'Product removed');
    } catch {
      toast('error', 'Failed to delete product');
    }
  }

  async function loadEvents() {
    try {
      const data = await fetchStoreEvents(store.id);
      setEvents(data);
    } catch {
      // silent
    } finally {
      setEventsLoading(false);
    }
  }

  useEffect(() => {
    if (!showEvents) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    setEventsLoading(true);
    loadEvents();
    intervalRef.current = setInterval(loadEvents, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [showEvents, store.id]);

  const phaseStyle = PHASE_STYLES[store.phase] || 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border)]';
  const borderAccent = BORDER_ACCENT[store.phase] || 'border-l-[var(--border)]';
  const isInProgress = ['Pending', 'Provisioning', 'Configuring', 'Verifying', 'Upgrading', 'RollingBack'].includes(store.phase);
  const provisionDuration = store.startedAt && store.readyAt
    ? new Date(store.readyAt).getTime() - new Date(store.startedAt).getTime()
    : null;

  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] border-l-2 ${borderAccent} hover:border-[var(--border-strong)] transition-all duration-200 animate-fade-in`}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-base font-semibold text-[var(--text-primary)]">
              {store.storeName || store.id}
            </p>
            {store.storeName && (
              <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">{store.id}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--bg-input)] text-[var(--text-muted)] rounded">
                {store.engine}
              </span>
              {store.template && store.template !== 'general' && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#d4a843]/10 text-[#d4a843]/70 rounded">
                  {store.template}
                </span>
              )}
              <PhaseSteps currentPhase={store.phase} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {store.helmRevision && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-[var(--bg-input)] text-[var(--text-muted)] rounded">
                rev {store.helmRevision}
              </span>
            )}
            <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${phaseStyle}`}>
              {store.phase}
            </span>
          </div>
        </div>

        {store.message && (
          <p className={`text-sm mb-3 ${store.phase === 'Failed' ? 'text-red-400 font-medium' : 'text-[var(--text-muted)]'}`}>
            {store.message}
          </p>
        )}

        {isInProgress && store.startedAt && (
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-3.5 h-3.5 text-amber-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <ElapsedTimer startedAt={store.startedAt} />
          </div>
        )}

        {store.phase === 'Ready' && provisionDuration && (
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Provisioned in <span className="font-mono font-medium text-[var(--text-body)]">{formatDuration(provisionDuration)}</span>
          </p>
        )}

        {deleteError && (
          <p className="text-xs text-red-400 mb-3 animate-fade-in">{deleteError}</p>
        )}

        {store.url && store.phase === 'Ready' && (
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={store.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-black bg-[#d4a843] rounded-lg hover:bg-[#c8992e] transition-colors"
            >
              View Storefront
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </a>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                let c = creds;
                if (!c) {
                  c = await fetchStoreCredentials(store.id);
                  setCreds(c);
                }
                if (c?.password) {
                  await navigator.clipboard.writeText(c.password);
                  toast('info', 'Password copied — paste in WP-Admin');
                }
                setShowCreds(true);
                const wpBase = store.url!.replace(/\/shop\/?$/, '');
                window.open(`${wpBase}/wp-login.php?log=${c?.username || 'user'}&redirect_to=${encodeURIComponent('/wp-admin/admin.php?page=wc-admin')}`, '_blank');
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--text-body)] bg-[var(--bg-input)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            >
              Manage Store
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (showProducts) { setShowProducts(false); return; }
                if (products.length === 0) loadProducts();
                setShowProducts(true);
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors"
            >
              {showProducts ? 'Hide' : 'Products'}
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (showMetrics) { setShowMetrics(false); return; }
                if (!metrics) {
                  const m = await fetchStoreMetrics(store.id);
                  setMetrics(m);
                }
                setShowMetrics(true);
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors"
            >
              {showMetrics ? 'Hide' : 'Resources'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleCopyUrl(); }}
              className="p-1 text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
              title="Copy URL"
            >
              {copied ? (
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
              )}
            </button>
          </div>
        )}

        {showCreds && creds && (
          <div className="mt-3 px-3 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">WP-Admin Login</p>
              <button onClick={() => setShowCreds(false)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-body)]">hide</button>
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-xs text-[var(--text-body)]">
                <span className="text-[var(--text-muted)]">user:</span> <span className="font-mono font-medium">{creds.username}</span>
              </span>
              <span className="text-xs text-[var(--text-body)]">
                <span className="text-[var(--text-muted)]">pass:</span> <span className="font-mono font-medium">{creds.password}</span>
              </span>
              <button
                onClick={async () => {
                  if (creds.password) {
                    await navigator.clipboard.writeText(creds.password);
                    toast('info', 'Password copied');
                  }
                }}
                className="text-[10px] text-[#d4a843] hover:text-[#c8992e] font-medium"
              >
                copy
              </button>
            </div>
          </div>
        )}

        {showMetrics && metrics && (
          <div className="mt-3 px-3 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] animate-fade-in" onClick={e => e.stopPropagation()}>
            <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">Resource Usage</p>
            <div className="space-y-1.5">
              {metrics.pods.map(pod => (
                <div key={pod.name} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pod.ready ? 'bg-emerald-500' : 'bg-[var(--bg-input)]'}`} />
                  <span className="font-mono text-[var(--text-muted)] truncate flex-1">{pod.name.split('-').slice(-2).join('-')}</span>
                  {pod.cpu && <span className="text-[var(--text-muted)]">{pod.cpu}</span>}
                  {pod.memory && <span className="text-[var(--text-muted)]">{pod.memory}</span>}
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs pt-1 border-t border-[var(--border)]">
                <span className="text-[var(--text-muted)]">Storage:</span>
                <span className="font-mono text-[var(--text-body)]">{metrics.storage.total}</span>
              </div>
            </div>
          </div>
        )}

        {showProducts && (
          <div className="mt-3 px-3 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Products ({products.length})</p>
              <button onClick={loadProducts} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-body)]">refresh</button>
            </div>
            {productsLoading && products.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-2">Loading...</p>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {products.map(product => (
                  <div key={product.id} className="flex items-center gap-2 text-xs group">
                    {product.images?.[0]?.src ? (
                      <img src={product.images[0].src} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-6 h-6 rounded bg-[var(--bg-input)] shrink-0" />
                    )}
                    <span className="text-[var(--text-body)] truncate flex-1">{product.name}</span>
                    <span className="font-mono text-[var(--text-muted)]">${product.price || product.regular_price}</span>
                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      className="text-[var(--text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove product"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 pt-2 border-t border-[var(--border)] space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Product name"
                  value={newProduct.name}
                  onChange={e => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
                  className="flex-1 text-xs px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-strong)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[#d4a843]/50 focus:outline-none"
                  onKeyDown={e => e.key === 'Enter' && handleAddProduct()}
                />
                <input
                  type="text"
                  placeholder="Price"
                  value={newProduct.price}
                  onChange={e => setNewProduct(prev => ({ ...prev, price: e.target.value }))}
                  className="w-16 text-xs px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-strong)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[#d4a843]/50 focus:outline-none"
                  onKeyDown={e => e.key === 'Enter' && handleAddProduct()}
                />
                <button
                  onClick={handleAddProduct}
                  disabled={addingProduct || !newProduct.name.trim()}
                  className="text-xs font-medium text-[#d4a843] hover:text-[#c8992e] disabled:opacity-50 px-2 py-1"
                >
                  {addingProduct ? '...' : 'Add'}
                </button>
              </div>
              <input
                type="text"
                placeholder="Image URL (optional)"
                value={newProduct.imageUrl}
                onChange={e => setNewProduct(prev => ({ ...prev, imageUrl: e.target.value }))}
                className="w-full text-xs px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-strong)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[#d4a843]/50 focus:outline-none"
                onKeyDown={e => e.key === 'Enter' && handleAddProduct()}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border)]">
          <span className="text-[11px] font-mono text-[var(--text-dim)]">
            {store.createdAt ? timeAgo(store.createdAt) : '\u2014'}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); setShowEvents(!showEvents); }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors"
            >
              {showEvents ? 'Hide' : 'Events'}
            </button>
            {store.phase === 'Failed' && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRetry(); }}
                disabled={retrying}
                className="text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
              >
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
            {confirmDelete ? (
              <span className="flex items-center gap-2 animate-fade-in">
                <span className="text-xs text-red-400">Delete?</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  disabled={deleting}
                  className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                >
                  {deleting ? 'Deleting...' : 'Yes'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {showEvents && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3 rounded-b-xl" onClick={e => e.stopPropagation()}>
          {eventsLoading && events.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-3">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-3">No events yet</p>
          ) : (
            <div className="max-h-[250px] overflow-y-auto space-y-1">
              {events.map((event, i) => (
                <div
                  key={`${event.reason}-${event.timestamp}-${i}`}
                  className={`px-3 py-2 rounded text-xs ${
                    event.type === 'Warning'
                      ? 'bg-red-500/5 border-l-2 border-red-400/60'
                      : 'bg-[var(--bg-surface)] border-l-2 border-emerald-400/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-[var(--text-body)]">{event.reason}</span>
                      <span className="text-[var(--text-muted)] ml-1.5">{event.message}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-dim)] whitespace-nowrap shrink-0">
                      {timeAgo(event.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
