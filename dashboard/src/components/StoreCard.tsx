import { useState, useEffect, useRef } from 'react';
import type { Store, StoreEvent } from '../api.ts';
import { deleteStore, fetchStoreEvents } from '../api.ts';

interface StoreCardProps {
  store: Store;
  onDeleted: () => void;
}

const PHASE_STYLES: Record<string, string> = {
  Ready: 'bg-green-100 text-green-800',
  Provisioning: 'bg-amber-100 text-amber-800',
  Configuring: 'bg-amber-100 text-amber-800',
  Verifying: 'bg-amber-100 text-amber-800',
  Pending: 'bg-amber-100 text-amber-800',
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
  const [showEvents, setShowEvents] = useState(false);
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const phaseStyle = PHASE_STYLES[store.phase] || 'bg-gray-100 text-gray-600';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-200">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-mono text-lg font-semibold text-gray-900">{store.id}</p>
            <span className="inline-block mt-1 px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded">
              {store.engine}
            </span>
          </div>
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${phaseStyle}`}>
            {store.phase}
          </span>
        </div>

        {store.message && (
          <p className={`text-sm mb-3 ${store.phase === 'Failed' ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            {store.message}
          </p>
        )}

        {store.url && store.phase === 'Ready' && (
          <a
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            Open Store
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
        )}

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-400">
            {store.createdAt ? timeAgo(store.createdAt) : '\u2014'}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowEvents(!showEvents)}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showEvents ? 'Hide Events' : 'Events'}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>

      {showEvents && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 rounded-b-xl">
          {eventsLoading && events.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No events yet</p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {events.map((event, i) => (
                <div
                  key={`${event.reason}-${event.timestamp}-${i}`}
                  className={`px-3 py-2 rounded ${
                    event.type === 'Warning'
                      ? 'bg-red-50 border-l-4 border-red-400'
                      : 'border-l-4 border-green-400 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-gray-800">{event.reason}</span>
                      <span className="text-xs text-gray-500 ml-1.5">{event.message}</span>
                      {event.component && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{event.component}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 mt-0.5">
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
