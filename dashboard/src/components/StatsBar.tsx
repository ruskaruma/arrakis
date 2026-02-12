import type { Store } from '../api.ts';

interface StatsBarProps {
  stores: Store[];
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function StatsBar({ stores }: StatsBarProps) {
  const total = stores.length;
  const ready = stores.filter(s => s.phase === 'Ready').length;
  const provisioning = stores.filter(s => ['Pending', 'Provisioning', 'Configuring', 'Verifying'].includes(s.phase)).length;
  const failed = stores.filter(s => s.phase === 'Failed').length;

  const provisionTimes = stores
    .filter(s => s.startedAt && s.readyAt)
    .map(s => new Date(s.readyAt!).getTime() - new Date(s.startedAt!).getTime());
  const avgProvisionMs = provisionTimes.length > 0
    ? Math.round(provisionTimes.reduce((a, b) => a + b, 0) / provisionTimes.length)
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Total</p>
        <p className="text-2xl font-semibold text-gray-900 mt-0.5 font-mono">{total}</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-[11px] font-medium text-emerald-500 uppercase tracking-wider">Ready</p>
        <p className="text-2xl font-semibold text-emerald-600 mt-0.5 font-mono">{ready}</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-[11px] font-medium text-amber-500 uppercase tracking-wider">Provisioning</p>
        <p className="text-2xl font-semibold text-amber-600 mt-0.5 font-mono">{provisioning}</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
          {failed > 0 ? 'Failed' : 'Avg Time'}
        </p>
        <p className={`text-2xl font-semibold mt-0.5 font-mono ${failed > 0 ? 'text-red-600' : 'text-gray-600'}`}>
          {failed > 0 ? failed : avgProvisionMs ? formatDuration(avgProvisionMs) : '\u2014'}
        </p>
      </div>
    </div>
  );
}
