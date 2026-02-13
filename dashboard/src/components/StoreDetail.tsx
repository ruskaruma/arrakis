import { useState, useEffect } from 'react';
import type { Store, StoreEvent, StoreCredentials, StoreMetrics, Product, HelmRevision } from '../api.ts';
import { deleteStore, fetchStoreEvents, fetchStoreCredentials, fetchStoreMetrics, fetchProducts, createProduct, deleteProduct, fetchRevisions, rollbackToRevision } from '../api.ts';
import { timeAgo, formatDuration, copyToClipboard } from '../utils.ts';
import { toast } from './Toast.tsx';

interface StoreDetailProps {
  store: Store;
  onBack: () => void;
  onDeleted: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-[var(--text-dim)] hover:text-[#d4a843] transition-colors shrink-0"
      title="Copy"
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
  );
}

export default function StoreDetail({ store, onBack, onDeleted }: StoreDetailProps) {
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [creds, setCreds] = useState<StoreCredentials | null>(null);
  const [metrics, setMetrics] = useState<StoreMetrics | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', imageUrl: '' });
  const [revisions, setRevisions] = useState<HelmRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  async function loadProducts() {
    setProductsLoading(true);
    try { setProducts(await fetchProducts(store.id)); }
    catch { /* silent */ }
    finally { setProductsLoading(false); }
  }

  async function handleAddProduct() {
    if (!newProduct.name.trim()) return;
    setAddingProduct(true);
    try {
      const images = newProduct.imageUrl.trim() ? [{ src: newProduct.imageUrl.trim() }] : undefined;
      await createProduct(store.id, { name: newProduct.name.trim(), regular_price: newProduct.price || '0', images });
      setNewProduct({ name: '', price: '', imageUrl: '' });
      await loadProducts();
      toast('success', 'Product added');
    } catch { toast('error', 'Failed to add product'); }
    finally { setAddingProduct(false); }
  }

  async function handleDeleteProduct(productId: number) {
    try {
      await deleteProduct(store.id, productId);
      setProducts(prev => prev.filter(p => p.id !== productId));
      toast('info', 'Product removed');
    } catch { toast('error', 'Failed to delete product'); }
  }

  async function loadRevisions() {
    setRevisionsLoading(true);
    try { setRevisions(await fetchRevisions(store.id)); }
    catch { /* silent */ }
    finally { setRevisionsLoading(false); }
  }

  async function handleRollback(revision: number) {
    setRollingBack(revision);
    try {
      await rollbackToRevision(store.id, revision);
      toast('info', `Rolling back to revision ${revision}`);
    } catch { toast('error', 'Rollback failed'); }
    finally { setRollingBack(null); }
  }

  useEffect(() => {
    fetchStoreEvents(store.id).then(setEvents).catch(() => {}).finally(() => setEventsLoading(false));
    if (store.phase === 'Ready') {
      fetchStoreCredentials(store.id).then(setCreds).catch(() => {});
      fetchStoreMetrics(store.id).then(setMetrics).catch(() => {});
      loadProducts();
    }
    loadRevisions();
  }, [store.id, store.phase]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteStore(store.id);
      toast('info', `${store.storeName || store.id} teardown started`);
      onDeleted();
    } catch {
      toast('error', 'Failed to delete store');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const phase = store.phase || 'Pending';
  const ns = `store-${store.id}`;
  const provisionDuration = store.startedAt && store.readyAt
    ? new Date(store.readyAt).getTime() - new Date(store.startedAt).getTime()
    : null;

  const commands = [
    `kubectl get pods -n ${ns}`,
    `kubectl logs -f deploy/${store.id}-wordpress -n ${ns}`,
    `kubectl describe store ${store.id}`,
    `kubectl get events -n ${ns} --sort-by='.lastTimestamp'`,
    `helm status ${store.id} -n ${ns}`,
  ];

  const crdFields = [
    ['apiVersion', 'arrakis.io/v1alpha1'],
    ['kind', 'Store'],
    ['name', store.id],
    ['namespace', ns],
    ['engine', store.engine],
    ['template', store.template || 'general'],
    ['phase', phase],
    ['url', store.url || '-'],
  ];

  const apiEndpoints = [
    ['GET', `/api/stores/${store.id}`, 'Store details'],
    ['GET', `/api/stores/${store.id}/events`, 'K8s events'],
    ['GET', `/api/stores/${store.id}/metrics`, 'Resource usage'],
    ['GET', `/api/stores/${store.id}/credentials`, 'WP-Admin creds'],
    ['GET', `/api/stores/${store.id}/revisions`, 'Revision history'],
    ['GET', `/api/stores/${store.id}/products`, 'Product list'],
    ['POST', `/api/stores/${store.id}/products`, 'Create product'],
    ['POST', `/api/stores/${store.id}/upgrade`, 'Upgrade store'],
    ['POST', `/api/stores/${store.id}/rollback`, 'Rollback store'],
    ['POST', `/api/stores/${store.id}/retry`, 'Retry failed store'],
    ['DELETE', `/api/stores/${store.id}`, 'Teardown store'],
  ];

  return (
    <div className="animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-8">
        <button onClick={onBack} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors">
          &larr; Back to stores
        </button>
        {confirmDelete ? (
          <span className="flex items-center gap-3">
            <span className="text-xs text-red-400">Delete this store?</span>
            <button onClick={handleDelete} disabled={deleting} className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50">
              {deleting ? 'Deleting...' : 'Yes, delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-body)]">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/15 hover:bg-red-500/20 transition-colors">
            Delete Store
          </button>
        )}
      </div>

      {/* Store info */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 mb-4">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">{store.storeName || store.id}</h2>
        {store.storeName && <p className="text-sm font-mono text-[var(--text-dim)] mt-0.5">{store.id}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
          <div>
            <span className="text-[var(--text-dim)] text-xs">Phase</span>
            <p className={`mt-0.5 font-medium ${phase === 'Ready' ? 'text-emerald-400' : phase === 'Failed' ? 'text-red-400' : 'text-[var(--text-body)]'}`}>{phase}</p>
          </div>
          <div>
            <span className="text-[var(--text-dim)] text-xs">Engine</span>
            <p className="text-[var(--text-body)] mt-0.5">{store.engine}</p>
          </div>
          <div>
            <span className="text-[var(--text-dim)] text-xs">Template</span>
            <p className="text-[var(--text-body)] mt-0.5">{store.template || 'general'}</p>
          </div>
          <div>
            <span className="text-[var(--text-dim)] text-xs">Created</span>
            <p className="text-[var(--text-body)] mt-0.5">{store.createdAt ? timeAgo(store.createdAt) : '-'}</p>
          </div>
          {store.helmRevision && (
            <div>
              <span className="text-[var(--text-dim)] text-xs">Helm Revision</span>
              <p className="text-[var(--text-body)] mt-0.5 font-mono">{store.helmRevision}</p>
            </div>
          )}
          {store.lastUpgradedAt && (
            <div>
              <span className="text-[var(--text-dim)] text-xs">Last Upgraded</span>
              <p className="text-[var(--text-body)] mt-0.5">{timeAgo(store.lastUpgradedAt)}</p>
            </div>
          )}
        </div>
        {provisionDuration && (
          <p className="text-xs text-[var(--text-dim)] mt-3">Provisioned in <span className="font-mono text-[var(--text-secondary)]">{formatDuration(provisionDuration)}</span></p>
        )}
      </div>

      {/* Quick actions */}
      {phase === 'Ready' && store.url && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <a href={store.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#d4a843] text-black font-medium text-sm hover:bg-[#c8992e] transition-colors">
            Open Store
          </a>
          <button
            onClick={async () => {
              let c = creds;
              if (!c) { c = await fetchStoreCredentials(store.id); setCreds(c); }
              if (c?.password) { await copyToClipboard(c.password); toast('info', 'Password copied'); }
              const wpBase = store.url!.replace(/\/shop\/?$/, '');
              window.open(`${wpBase}/wp-login.php?log=${c?.username || 'user'}&redirect_to=${encodeURIComponent('/wp-admin/admin.php?page=wc-admin')}`, '_blank');
            }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-body)] text-sm hover:bg-[var(--bg-hover)] transition-colors"
          >
            WP-Admin
          </button>
          <button
            onClick={async () => { await copyToClipboard(store.url!); toast('info', 'URL copied'); }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-body)] text-sm hover:bg-[var(--bg-hover)] transition-colors"
          >
            Copy URL
          </button>
        </div>
      )}

      {/* Credentials */}
      {creds && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
          <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-3">WP-Admin Credentials</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-[var(--text-dim)]">Username</span>
              <p className="font-mono text-sm text-[var(--text-body)] mt-0.5">{creds.username}</p>
            </div>
            <div>
              <span className="text-xs text-[var(--text-dim)]">Password</span>
              <p className="font-mono text-sm text-[var(--text-body)] mt-0.5">{creds.password || '-'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Products */}
      {phase === 'Ready' && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">Products ({products.length})</p>
            <button onClick={loadProducts} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-body)]">refresh</button>
          </div>
          {productsLoading && products.length === 0 ? (
            <p className="text-xs text-[var(--text-dim)] py-3">Loading products...</p>
          ) : products.length === 0 ? (
            <p className="text-xs text-[var(--text-dim)] py-3">No products yet</p>
          ) : (
            <div className="space-y-1.5 max-h-[250px] overflow-y-auto mb-3">
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
          <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
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

      {/* Metrics */}
      {metrics && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
          <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-3">Resource Usage</p>
          <div className="space-y-1.5">
            {metrics.pods.map(pod => (
              <div key={pod.name} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pod.ready ? 'bg-emerald-500' : 'bg-[var(--bg-input)]'}`} />
                <span className="font-mono text-[var(--text-muted)] truncate flex-1">{pod.name.split('-').slice(-2).join('-')}</span>
                {pod.cpu && <span className="text-[var(--text-dim)]">{pod.cpu}</span>}
                {pod.memory && <span className="text-[var(--text-dim)]">{pod.memory}</span>}
              </div>
            ))}
            <div className="flex items-center gap-2 text-xs pt-1.5 border-t border-[var(--border)]">
              <span className="text-[var(--text-dim)]">Storage:</span>
              <span className="font-mono text-[var(--text-secondary)]">{metrics.storage.total}</span>
            </div>
          </div>
        </div>
      )}

      {/* Revision History */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">Revision History</p>
          <button onClick={loadRevisions} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-body)]">refresh</button>
        </div>
        {revisionsLoading && revisions.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)] py-3">Loading revisions...</p>
        ) : revisions.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)] py-3">No revisions yet</p>
        ) : (
          <div className="space-y-0 max-h-[300px] overflow-y-auto">
            <div className="grid grid-cols-[3rem_1fr_5rem_5rem_auto] gap-2 text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wider pb-2 border-b border-[var(--border)]">
              <span>Rev</span>
              <span>Description</span>
              <span>Status</span>
              <span>Updated</span>
              <span></span>
            </div>
            {[...revisions].reverse().map((rev) => {
              const isCurrent = store.helmRevision === rev.revision;
              return (
                <div
                  key={rev.revision}
                  className={`grid grid-cols-[3rem_1fr_5rem_5rem_auto] gap-2 items-center py-2 border-b border-[var(--border-subtle)] last:border-0 ${isCurrent ? 'bg-emerald-500/5' : ''}`}
                >
                  <span className={`font-mono text-xs ${isCurrent ? 'text-emerald-400 font-medium' : 'text-[var(--text-body)]'}`}>
                    {rev.revision}{isCurrent ? '*' : ''}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] truncate">{rev.description}</span>
                  <span className={`text-xs ${rev.status === 'deployed' ? 'text-emerald-400' : rev.status === 'superseded' ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>
                    {rev.status}
                  </span>
                  <span className="text-[10px] text-[var(--text-dim)]">{timeAgo(rev.updated)}</span>
                  <span>
                    {!isCurrent && (
                      <button
                        onClick={() => handleRollback(rev.revision)}
                        disabled={rollingBack !== null}
                        className="text-[10px] font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
                      >
                        {rollingBack === rev.revision ? 'Rolling back...' : 'Rollback'}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Event timeline */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
        <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-3">Event Timeline</p>
        {eventsLoading ? (
          <p className="text-xs text-[var(--text-dim)] py-3">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)] py-3">No events yet</p>
        ) : (
          <div className="space-y-0 max-h-[300px] overflow-y-auto">
            {events.map((event, i) => (
              <div key={`${event.reason}-${event.timestamp}-${i}`} className="flex items-start gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${event.type === 'Warning' ? 'bg-red-400' : 'bg-emerald-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--text-body)]">{event.message}</p>
                  <p className="text-[10px] text-[var(--text-dim)] mt-0.5">{event.reason} &middot; {timeAgo(event.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Developer: Quick Commands */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
        <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-3">Quick Commands</p>
        <div className="space-y-1">
          {commands.map(cmd => (
            <div key={cmd} className="flex items-center justify-between gap-3 bg-[var(--bg-input)] rounded px-3 py-2">
              <code className="font-mono text-xs text-[var(--text-muted)] truncate">$ {cmd}</code>
              <CopyButton text={cmd} />
            </div>
          ))}
        </div>
      </div>

      {/* Developer: CRD Summary */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-4">
        <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-3">Store Resource</p>
        <div className="space-y-0.5">
          {crdFields.map(([key, val]) => (
            <div key={key} className="flex gap-4 py-1">
              <span className="text-[var(--text-dim)] text-xs font-mono w-24 shrink-0">{key}</span>
              <span className={`text-xs font-mono truncate ${
                key === 'phase' && val === 'Ready' ? 'text-emerald-400' :
                key === 'url' && val !== '-' ? 'text-[#d4a843]' :
                'text-[var(--text-secondary)]'
              }`}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Developer: API Reference */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-3">API Endpoints</p>
        <div className="space-y-0.5">
          {apiEndpoints.map(([method, path, desc]) => (
            <div key={`${method}-${path}`} className="flex items-center gap-3 py-1">
              <span className="text-[#d4a843] font-mono text-xs font-medium w-12 shrink-0">{method}</span>
              <span className="text-[var(--text-secondary)] font-mono text-xs truncate flex-1">{path}</span>
              <span className="text-[var(--text-dim)] text-xs shrink-0 hidden sm:inline">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
