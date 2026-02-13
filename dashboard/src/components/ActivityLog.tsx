import { useState, useEffect, useRef } from 'react';
import type { StoreEvent } from '../api.ts';
import { fetchAllEvents } from '../api.ts';
import { timeAgo } from '../utils.ts';

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function ActivityLog() {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadEvents() {
    try {
      const data = await fetchAllEvents();
      setEvents(data.slice(0, 50));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!expanded) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    setLoading(true);
    loadEvents();
    intervalRef.current = setInterval(loadEvents, 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expanded]);

  const warningCount = events.filter(e => e.type === 'Warning').length;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-[var(--bg-hover)] transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-sm font-semibold text-[var(--text-primary)]">Activity Log</span>
          {!expanded && warningCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400 rounded-full">
              {warningCount}
            </span>
          )}
        </div>
        {expanded && (
          <span
            onClick={(e) => { e.stopPropagation(); setLoading(true); loadEvents(); }}
            className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors"
          >
            Refresh
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)]">
          {loading && events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">No events across stores</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {events.map((event, i) => (
                <div
                  key={`${event.storeId}-${event.reason}-${event.timestamp}-${i}`}
                  className={`flex items-start gap-3 px-6 py-3 ${
                    event.type === 'Warning' ? 'bg-red-500/5' : ''
                  }`}
                >
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      event.type === 'Warning' ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                  />
                  {event.storeId && (
                    <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-[var(--bg-input)] text-[var(--text-muted)] rounded">
                      {event.storeId}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-[var(--text-body)]">{event.reason}</span>
                    <span className="text-xs text-[var(--text-muted)] ml-1.5">{event.message}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--text-dim)] whitespace-nowrap shrink-0 mt-0.5" title={formatTime(event.timestamp)}>
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
