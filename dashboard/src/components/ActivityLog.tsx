import { useState, useEffect, useRef } from 'react';
import type { StoreEvent } from '../api.ts';
import { fetchAllEvents } from '../api.ts';

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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-lg font-semibold text-gray-900">Activity Log</span>
          {!expanded && warningCount > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 rounded-full">
              {warningCount}
            </span>
          )}
        </div>
        {expanded && (
          <span
            onClick={(e) => { e.stopPropagation(); setLoading(true); loadEvents(); }}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            Refresh
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {loading && events.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No events across stores</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-100">
              {events.map((event, i) => (
                <div
                  key={`${event.storeId}-${event.reason}-${event.timestamp}-${i}`}
                  className={`flex items-start gap-3 px-5 py-3 ${
                    i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  } ${event.type === 'Warning' ? 'bg-red-50' : ''}`}
                >
                  {event.storeId && (
                    <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 rounded">
                      {event.storeId}
                    </span>
                  )}
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      event.type === 'Warning' ? 'bg-red-500' : 'bg-green-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-gray-800">{event.reason}</span>
                    <span className="text-xs text-gray-500 ml-1.5">{event.message}</span>
                    {event.component && (
                      <span className="text-[10px] text-gray-400 ml-1.5">{event.component}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 mt-0.5">
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
