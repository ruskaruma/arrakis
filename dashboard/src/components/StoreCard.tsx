import { useState, useEffect, useRef } from 'react';
import type { Store, StoreEvent } from '../api.ts';
import { deleteStore, fetchStoreEvents } from '../api.ts';

interface StoreCardProps {
  store: Store;
  onDeleted: () => void;
}

const PHASES = ['Pending', 'Provisioning', 'Configuring', 'Verifying', 'Ready'] as const;

const PHASE_STYLES: Record<string, string> = {
  Ready: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Provisioning: 'bg-amber-50 text-amber-700 border border-amber-200',
  Configuring: 'bg-amber-50 text-amber-700 border border-amber-200',
  Verifying: 'bg-blue-50 text-blue-700 border border-blue-200',
  Pending: 'bg-gray-50 text-gray-600 border border-gray-200',
  Failed: 'bg-red-50 text-red-700 border border-red-200',
  Deleting: 'bg-gray-50 text-gray-500 border border-gray-200',
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

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

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startedAt).getTime());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - new Date(startedAt).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="font-mono text-xs text-amber-600">{formatDuration(elapsed)}</span>;
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
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                isComplete ? 'bg-emerald-500' :
                isCurrent ? 'bg-amber-500 animate-pulse-dot' :
                'bg-gray-200'
              }`}
              title={phase}
            />
            {i < PHASES.length - 1 && (
              <div className={`w-3 h-px ${isComplete ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function StoreCard({ store, onDeleted }: StoreCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStore(store.id);
      onDeleted();
    } catch {
      setDeleteError('Failed to delete');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCopyUrl() {
    if (!store.url) return;
    await navigator.clipboard.writeText(store.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  const phaseStyle = PHASE_STYLES[store.phase] || 'bg-gray-50 text-gray-500 border border-gray-200';
  const isInProgress = ['Pending', 'Provisioning', 'Configuring', 'Verifying'].includes(store.phase);
  const provisionDuration = store.startedAt && store.readyAt
    ? new Date(store.readyAt).getTime() - new Date(store.startedAt).getTime()
    : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-all duration-200 animate-fade-in">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-base font-semibold text-gray-900">
              {store.storeName || store.id}
            </p>
            {store.storeName && (
              <p className="font-mono text-xs text-gray-400 mt-0.5">{store.id}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded">
                {store.engine}
              </span>
              {store.template && store.template !== 'general' && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary-50 text-primary-600 rounded">
                  {store.template}
                </span>
              )}
              <PhaseSteps currentPhase={store.phase} />
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${phaseStyle}`}>
            {store.phase}
          </span>
        </div>

        {store.message && (
          <p className={`text-sm mb-3 ${store.phase === 'Failed' ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            {store.message}
          </p>
        )}

        {isInProgress && store.startedAt && (
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-3.5 h-3.5 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <ElapsedTimer startedAt={store.startedAt} />
          </div>
        )}

        {store.phase === 'Ready' && provisionDuration && (
          <p className="text-xs text-gray-400 mb-3">
            Provisioned in <span className="font-mono font-medium text-gray-600">{formatDuration(provisionDuration)}</span>
          </p>
        )}

        {deleteError && (
          <p className="text-xs text-red-500 mb-3 animate-fade-in">{deleteError}</p>
        )}

        {store.url && store.phase === 'Ready' && (
          <div className="flex items-center gap-3">
            <a
              href={store.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              Open Store
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </a>
            <a
              href={`${store.url}/wp-admin`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              WP-Admin
            </a>
            <button
              onClick={handleCopyUrl}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title="Copy URL"
            >
              {copied ? (
                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <span className="text-[11px] font-mono text-gray-400">
            {store.createdAt ? timeAgo(store.createdAt) : '\u2014'}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowEvents(!showEvents)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showEvents ? 'Hide' : 'Events'}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-2 animate-fade-in">
                <span className="text-xs text-red-600">Delete?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 transition-colors"
                >
                  {deleting ? 'Deleting...' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-gray-400 hover:text-red-600 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {showEvents && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3 rounded-b-xl">
          {eventsLoading && events.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No events yet</p>
          ) : (
            <div className="max-h-[250px] overflow-y-auto space-y-1">
              {events.map((event, i) => (
                <div
                  key={`${event.reason}-${event.timestamp}-${i}`}
                  className={`px-3 py-2 rounded text-xs ${
                    event.type === 'Warning'
                      ? 'bg-red-50 border-l-2 border-red-400'
                      : 'bg-white border-l-2 border-emerald-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-800">{event.reason}</span>
                      <span className="text-gray-500 ml-1.5">{event.message}</span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-400 whitespace-nowrap shrink-0">
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
