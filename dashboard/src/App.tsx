import { useState, useEffect, useCallback } from 'react';
import type { Store } from './api.ts';
import { fetchStores } from './api.ts';
import Header from './components/Header.tsx';
import CreateStoreModal from './components/CreateStoreModal.tsx';
import StoreCard from './components/StoreCard.tsx';
import EmptyState from './components/EmptyState.tsx';
import ActivityLog from './components/ActivityLog.tsx';

const POLL_INTERVAL = 5000;

export default function App() {
  const [stores, setStores] = useState<Store[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    try {
      const data = await fetchStores();
      setStores(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect to API');
    }
  }, []);

  useEffect(() => {
    loadStores();
    const id = setInterval(loadStores, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [loadStores]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Header storeCount={stores.length} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Stores</h2>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Create Store
          </button>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {stores.length === 0 && !error ? (
          <EmptyState onCreate={() => setShowModal(true)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {stores.map(store => (
              <StoreCard key={store.id} store={store} onDeleted={loadStores} />
            ))}
          </div>
        )}

        {stores.length > 0 && (
          <div className="mt-8">
            <ActivityLog />
          </div>
        )}
      </main>

      {showModal && (
        <CreateStoreModal onClose={() => setShowModal(false)} onCreated={loadStores} />
      )}
    </div>
  );
}
