import { useState, useEffect, useCallback } from 'react';
import type { Store, User } from './api.ts';
import { fetchStores, fetchUser } from './api.ts';
import Header from './components/Header.tsx';
import CreateStoreModal from './components/CreateStoreModal.tsx';
import StoreCard from './components/StoreCard.tsx';
import EmptyState from './components/EmptyState.tsx';
import ActivityLog from './components/ActivityLog.tsx';
import StatsBar from './components/StatsBar.tsx';
import LoginPage from './components/LoginPage.tsx';

const POLL_INTERVAL = 5000;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUser().then(u => {
      setUser(u);
      setAuthChecked(true);
    });
  }, []);

  const loadStores = useCallback(async () => {
    try {
      const data = await fetchStores();
      setStores(data);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('401')) {
        setUser(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to connect to API');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadStores();
    const id = setInterval(loadStores, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [loadStores, user]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Header storeCount={stores.length} user={user} onLogout={() => setUser(null)} />

      <main className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Stores</h2>
            <p className="text-sm text-gray-500 mt-1">Manage your provisioned store instances</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
          >
            Create Store
          </button>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 animate-fade-in">
            {error}
          </div>
        )}

        {stores.length > 0 && <StatsBar stores={stores} />}

        {stores.length === 0 && !error ? (
          <EmptyState onCreate={() => setShowModal(true)} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {stores.map(store => (
              <StoreCard key={store.id} store={store} onDeleted={loadStores} />
            ))}
          </div>
        )}

        {stores.length > 0 && (
          <div className="mt-10">
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
