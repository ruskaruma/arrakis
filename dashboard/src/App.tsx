import { useState, useEffect, useCallback, useRef } from 'react';
import type { Store, User } from './api.ts';
import { fetchStores, fetchUser } from './api.ts';
import { ThemeProvider } from './ThemeContext.tsx';
import Header from './components/Header.tsx';
import CreateStoreModal from './components/CreateStoreModal.tsx';
import StoreCard from './components/StoreCard.tsx';
import StoreDetail from './components/StoreDetail.tsx';
import EmptyState from './components/EmptyState.tsx';
import ActivityLog from './components/ActivityLog.tsx';
import StatsBar from './components/StatsBar.tsx';
import LoginPage from './components/LoginPage.tsx';
import ToastContainer, { toast } from './components/Toast.tsx';

const POLL_INTERVAL = 5000;

function SkeletonCard() {
  return (
    <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-5 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="h-5 w-36 bg-[var(--bg-input)] rounded" />
          <div className="h-3 w-20 bg-[var(--bg-input)] rounded mt-2" />
        </div>
        <div className="h-6 w-20 bg-[var(--bg-input)] rounded-full" />
      </div>
      <div className="h-3.5 w-48 bg-[var(--bg-input)] rounded mt-4" />
      <div className="flex items-center justify-between mt-6 pt-3 border-t border-[var(--border)]">
        <div className="h-3 w-16 bg-[var(--bg-input)] rounded" />
        <div className="h-3 w-24 bg-[var(--bg-input)] rounded" />
      </div>
    </div>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const prevPhases = useRef<Record<string, string>>({});

  useEffect(() => {
    fetchUser().then(u => {
      setUser(u);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    const count = stores.length;
    document.title = count > 0 ? `Arrakis \u2014 ${count} store${count !== 1 ? 's' : ''}` : 'Arrakis';
  }, [stores.length]);

  useEffect(() => {
    const prev = prevPhases.current;
    for (const store of stores) {
      const old = prev[store.id];
      if (old && old !== store.phase) {
        if (store.phase === 'Ready') toast('success', `${store.storeName || store.id} is ready`);
        if (store.phase === 'Failed') toast('error', `${store.storeName || store.id} failed`);
      }
    }
    const next: Record<string, string> = {};
    for (const store of stores) next[store.id] = store.phase;
    prevPhases.current = next;
  }, [stores]);

  const loadStores = useCallback(async () => {
    try {
      const data = await fetchStores();
      setStores(data);
      setStoresLoaded(true);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('401')) {
        setUser(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to connect to API');
      setStoresLoaded(true);
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
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#d4a843] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const selectedStoreObj = selectedStore ? stores.find(s => s.id === selectedStore) : null;

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
        <Header storeCount={stores.length} user={user} onLogout={() => setUser(null)} />

        <main className="max-w-6xl mx-auto px-8 py-10">
          {selectedStoreObj ? (
            <StoreDetail
              store={selectedStoreObj}
              onBack={() => setSelectedStore(null)}
              onDeleted={() => { setSelectedStore(null); loadStores(); }}
            />
          ) : (
            <>
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-xl font-semibold text-[var(--text-primary)]">Your Stores</h2>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Create and manage your online stores</p>
                </div>
                <button
                  onClick={() => setShowModal(true)}
                  className="px-4 py-2.5 text-sm font-medium text-black bg-[#d4a843] rounded-lg hover:bg-[#c8992e] transition-colors"
                >
                  Create Store
                </button>
              </div>

              {error && (
                <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 animate-fade-in">
                  {error}
                </div>
              )}

              {stores.length > 0 && <StatsBar stores={stores} />}

              {!storesLoaded ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : stores.length === 0 && !error ? (
                <EmptyState onCreate={() => setShowModal(true)} />
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  {stores.map(store => (
                    <div key={store.id} onClick={() => setSelectedStore(store.id)} className="cursor-pointer">
                      <StoreCard store={store} onDeleted={loadStores} />
                    </div>
                  ))}
                </div>
              )}

              {stores.length > 0 && (
                <div className="mt-10">
                  <ActivityLog />
                </div>
              )}
            </>
          )}
        </main>

        {showModal && (
          <CreateStoreModal
            onClose={() => setShowModal(false)}
            onCreated={() => {
              loadStores();
              toast('info', 'Store provisioning started');
            }}
          />
        )}

        <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
