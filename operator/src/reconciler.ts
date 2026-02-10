import * as path from 'path';
import { Store, storeNamespace } from './types';
import {
  namespaceExists, createNamespace, deleteNamespace, applyResourceQuota,
  applyNetworkPolicies, applyLimitRange,
  updateStoreStatus, allPodsReady, getPodsReady,
  hasFinalizer, addFinalizer, removeFinalizer,
} from './k8s-helpers';
import { HelmManager } from './helm-manager';
import { setupWooCommerce } from './woocommerce-setup';
import { verifyStore } from './store-verifier';
import { log } from './logger';

const PROVISION_TIMEOUT_MS = 10 * 60 * 1_000;

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

    //Provisioning timeout
    if ((phase === 'Provisioning' || phase === 'Configuring') && store.status?.startedAt) {
      const elapsed = Date.now() - new Date(store.status.startedAt).getTime();
      if (elapsed > PROVISION_TIMEOUT_MS) {
        await updateStoreStatus(storeId, {
          phase: 'Failed',
          message: 'Provisioning timed out after 10 minutes',
        });
        log.warn('reconcile.timeout', 'Provisioning timed out', { storeId, elapsed });
        return;
      }
    }

    // ── Namespace + ResourceQuota ────────────────────────────────────────────

    if (!(await namespaceExists(ns))) {
      await updateStoreStatus(storeId, {
        phase: 'Provisioning',
        message: 'Creating namespace and resource quota',
        startedAt: new Date().toISOString(),
      });
      await createNamespace(ns, storeId);
      await applyResourceQuota(ns);
      await applyNetworkPolicies(ns);
      await applyLimitRange(ns);
      log.info('reconcile.ns', 'Namespace, quota, network policies, and limits created', { storeId, namespace: ns });
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
      const pods = await getPodsReady(ns);
      await updateStoreStatus(storeId, {
        phase: 'Provisioning',
        message: `Waiting for pods (${pods.ready}/${pods.total} ready)`,
      });
      return;
    }

    log.info('reconcile.pods', 'All pods ready', { storeId, namespace: ns });

    // ── Configuring (WP-CLI setup) ───────────────────────────────────────
    // Skip WP-CLI if we already completed it (phase is Verifying from a previous run)

    if (phase !== 'Verifying') {
      await updateStoreStatus(storeId, {
        phase: 'Configuring',
        message: 'Running WooCommerce setup via WP-CLI',
      });

      try {
        await setupWooCommerce(storeId, ns);
      } catch (err: any) {
        await updateStoreStatus(storeId, {
          phase: 'Failed',
          message: `WooCommerce setup failed: ${err.message}`,
        });
        return;
      }

      await updateStoreStatus(storeId, {
        phase: 'Verifying',
        message: 'Verifying store configuration',
      });
    }

    // ── Verifying ────────────────────────────────────────────────────────

    let verified: boolean;
    try {
      verified = await verifyStore(storeId, ns);
    } catch (err: any) {
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: `Verification error: ${err.message}`,
      });
      return;
    }

    if (!verified) {
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: 'Store verification failed (HTTP or product check)',
      });
      return;
    }

    // ── Ready ────────────────────────────────────────────────────────────

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
