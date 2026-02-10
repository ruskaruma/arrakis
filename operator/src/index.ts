import { Store, CRD_GROUP, CRD_VERSION, CRD_PLURAL } from './types';
import { customApi, watcher } from './k8s-helpers';
import { reconcile } from './reconciler';
import { log } from './logger';

const SYNC_INTERVAL_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

let watchReq: any = null;
let backoff = INITIAL_BACKOFF_MS;
let syncTimer: NodeJS.Timeout | null = null;

// ─── Watch ──────────────────────────────────────────────────────────────────

async function startWatch(): Promise<void> {
  const path = `/apis/${CRD_GROUP}/${CRD_VERSION}/namespaces/default/${CRD_PLURAL}`;
  log.info('watch.start', `Watching ${path}`);

  try {
    watchReq = await watcher.watch(
      path,
      {},
      async (type: string, obj: any) => {
        const store = obj as Store;
        const id = store.metadata.name;
        if (!id) return;

        log.info('watch.event', `${type} ${id}`, {
          storeId: id,
          phase: store.status?.phase || 'none',
        });

        if (type === 'ADDED' || type === 'MODIFIED') {
          try {
            await reconcile(store);
          } catch (err: any) {
            log.error('watch.reconcile.error', `Reconcile failed: ${err.message}`, { storeId: id });
          }
        }
      },
      (err: any) => {
        if (err) {
          log.error('watch.error', `Watch ended: ${err.message || err}`);
        } else {
          log.warn('watch.closed', 'Watch stream closed');
        }
        scheduleReconnect();
      }
    );

    backoff = INITIAL_BACKOFF_MS;
  } catch (err: any) {
    log.error('watch.failed', `Could not start watch: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  log.info('watch.reconnect', `Reconnecting in ${backoff}ms`);
  setTimeout(startWatch, backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
}

// ─── Periodic Sync ──────────────────────────────────────────────────────────

async function periodicSync(): Promise<void> {
  try {
    const res = await customApi.listNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: 'default',
      plural: CRD_PLURAL,
    });

    const stores = ((res as any).items || []) as Store[];

    for (const store of stores) {
      const phase = store.status?.phase;
      const terminal = phase === 'Ready' || phase === 'Failed';
      const deleting = !!store.metadata.deletionTimestamp;

      if (!terminal || deleting) {
        try {
          await reconcile(store);
        } catch (err: any) {
          log.error('sync.reconcile.error', `Reconcile failed: ${err.message}`, {
            storeId: store.metadata.name,
          });
        }
      }
    }
  } catch (err: any) {
    log.error('sync.error', `Periodic sync failed: ${err.message}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info('operator.start', 'Arrakis operator starting');

  await startWatch();

  syncTimer = setInterval(periodicSync, SYNC_INTERVAL_MS);
  await periodicSync();

  log.info('operator.ready', 'Operator running');

  const shutdown = (signal: string) => {
    log.info('operator.shutdown', `${signal} received, shutting down`);
    if (syncTimer) clearInterval(syncTimer);
    if (watchReq) {
      try { watchReq.destroy(); } catch {}
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  log.error('operator.fatal', err.message);
  process.exit(1);
});
