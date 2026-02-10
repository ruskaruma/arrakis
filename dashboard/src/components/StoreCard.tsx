import { useState } from 'react';
import type { Store } from '../api.ts';
import { deleteStore } from '../api.ts';

interface StoreCardProps {
  store: Store;
  onDeleted: () => void;
}

const PHASE_COLORS: Record<string, string> = {
  Ready: 'bg-green-100 text-green-800',
  Provisioning: 'bg-yellow-100 text-yellow-800',
  Configuring: 'bg-yellow-100 text-yellow-800',
  Verifying: 'bg-yellow-100 text-yellow-800',
  Pending: 'bg-yellow-100 text-yellow-800',
  Failed: 'bg-red-100 text-red-800',
  Deleting: 'bg-gray-100 text-gray-600',
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function StoreCard({ store, onDeleted }: StoreCardProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete store ${store.id}?`)) return;
    setDeleting(true);
    try {
      await deleteStore(store.id);
      onDeleted();
    } catch {
      alert('Failed to delete store');
    } finally {
      setDeleting(false);
    }
  }

  const phaseColor = PHASE_COLORS[store.phase] || 'bg-gray-100 text-gray-600';

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-mono text-sm font-medium text-gray-900">{store.id}</p>
          <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
            {store.engine}
          </span>
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${phaseColor}`}>
          {store.phase}
        </span>
      </div>

      {store.message && (
        <p className="text-xs text-gray-500 mb-2">{store.message}</p>
      )}

      {store.url && store.phase === 'Ready' ? (
        <a
          href={store.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline break-all"
        >
          {store.url}
        </a>
      ) : store.url ? (
        <p className="text-sm text-gray-400 break-all">{store.url}</p>
      ) : null}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-400">
          {store.createdAt ? timeAgo(store.createdAt) : '\u2014'}
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
