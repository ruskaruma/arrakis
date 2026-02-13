import type { Store } from '../api.ts';
import { formatDuration } from '../utils.ts';

interface StatsBarProps {
  stores: Store[];
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
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Total</p>
        <p className="text-2xl font-semibold text-[var(--text-primary)] mt-0.5 font-mono">{total}</p>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider">Ready</p>
        <p className="text-2xl font-semibold text-emerald-400 mt-0.5 font-mono">{ready}</p>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <p className="text-[11px] font-medium text-amber-400 uppercase tracking-wider">Provisioning</p>
        <p className="text-2xl font-semibold text-amber-400 mt-0.5 font-mono">{provisioning}</p>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          {failed > 0 ? 'Failed' : 'Avg Time'}
        </p>
        <p className={`text-2xl font-semibold mt-0.5 font-mono ${failed > 0 ? 'text-red-400' : 'text-[var(--text-body)]'}`}>
          {failed > 0 ? failed : avgProvisionMs ? formatDuration(avgProvisionMs) : '\u2014'}
        </p>
      </div>
    </div>
  );
}
