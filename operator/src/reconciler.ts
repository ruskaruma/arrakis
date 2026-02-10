import * as path from 'path';
import { Store, storeNamespace } from './types';
import {
  namespaceExists, createNamespace, deleteNamespace, applyResourceQuota,
  updateStoreStatus, allPodsReady, getPodsReady,
  hasFinalizer, addFinalizer, removeFinalizer,
} from './k8s-helpers';
import { HelmManager } from './helm-manager';
import { log } from './logger';

const PROVISION_TIMEOUT_MS = 15 * 60 * 1_000;

const CHART_PATH = path.resolve(__dirname, '../../helm-charts/woocommerce');
const VALUES_FILE = path.resolve(CHART_PATH, 'values-local.yaml');

const helm = new HelmManager(CHART_PATH, VALUES_FILE);

const activeReconciles = new Set<string>();

export async function reconcile(store: Store): Promise<void> {
  const storeId = store.metadata.name;
  const ns = storeNamespace(storeId);

  if (activeReconciles.has(storeId)) return;
  activeReconciles.add(storeId);

  try {
    if (store.metadata.deletionTimestamp) {
      await updateStoreStatus(storeId, { phase: 'Deleting', message: 'Tearing down store' });
      log.info('reconcile.delete', 'Deleting store', { storeId });

      await helm.uninstall(storeId, ns);
      log.info('reconcile.delete.helm', 'Helm release uninstalled', { storeId });

      await deleteNamespace(ns);
      log.info('reconcile.delete.ns', 'Namespace deleted', { storeId, namespace: ns });

      await removeFinalizer(store);
      log.info('reconcile.delete.done', 'Finalizer removed, deletion complete', { storeId });
      return;
    }

    if (!hasFinalizer(store)) {
      await addFinalizer(store);
      log.info('reconcile.finalizer', 'Finalizer added', { storeId });
      return;
    }

    const phase = store.status?.phase;
    if (phase === 'Ready' || phase === 'Failed') return;

    // ── Namespace + ResourceQuota ────────────────────────────────────────────

    if (!(await namespaceExists(ns))) {
      await updateStoreStatus(storeId, {
        phase: 'Provisioning',
        message: 'Creating namespace and resource quota',
        startedAt: new Date().toISOString(),
      });
      await createNamespace(ns, storeId);
      await applyResourceQuota(ns);
      log.info('reconcile.ns', 'Namespace and quota created', { storeId, namespace: ns });
    }

    // ── Helm Install ────────────────────────────────────────────────────────

    if (!(await helm.releaseExists(storeId, ns))) {
      await updateStoreStatus(storeId, {
        phase: 'Provisioning',
        message: 'Installing WordPress via Helm',
      });

      try {
        await helm.install(storeId, ns, {
          'wordpress.ingress.hostname': `${storeId}.127.0.0.1.nip.io`,
        });
        log.info('reconcile.helm', 'Helm release installed', { storeId, namespace: ns });
      } catch (err: any) {
        await updateStoreStatus(storeId, {
          phase: 'Failed',
          message: `Helm install failed: ${err.message}`,
        });
        return;
      }
    }

    // ── Pod Readiness ───────────────────────────────────────────────────────

    if (!(await allPodsReady(ns))) {
      const startedAt = store.status?.startedAt || store.metadata.creationTimestamp;
      if (startedAt) {
        const elapsed = Date.now() - new Date(startedAt).getTime();
        if (elapsed > PROVISION_TIMEOUT_MS) {
          const pods = await getPodsReady(ns);
          await updateStoreStatus(storeId, {
            phase: 'Failed',
            message: `Timed out waiting for pods (${pods.ready}/${pods.total} ready after 15m)`,
          });
          return;
        }
      }

      const pods = await getPodsReady(ns);
      await updateStoreStatus(storeId, {
        phase: 'Provisioning',
        message: `Waiting for pods (${pods.ready}/${pods.total} ready)`,
      });
      return;
    }

    log.info('reconcile.pods', 'All pods ready', { storeId, namespace: ns });

    // TODO: Provisioning → Configuring (WP-CLI setup) → Verifying → Ready
    // For now, skip Configuring/Verifying and go straight to Ready

    const storeUrl = `http://${storeId}.127.0.0.1.nip.io`;
    await updateStoreStatus(storeId, {
      phase: 'Ready',
      message: 'Store is running',
      url: storeUrl,
      readyAt: new Date().toISOString(),
    });
    log.info('reconcile.ready', `Store ready at ${storeUrl}`, { storeId });

  } catch (err: any) {
    log.error('reconcile.error', `Reconciliation error: ${err.message}`, { storeId });
    try {
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: `Unexpected error: ${err.message}`,
      });
    } catch {}
  } finally {
    activeReconciles.delete(storeId);
  }
}
