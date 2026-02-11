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
import { reconcileDuration, reconcileErrors, provisionDuration } from './metrics';

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
  const reconcileStart = Date.now();

  try {
    if (store.metadata.deletionTimestamp) {
      await handleDeletion(storeId, ns, store);
      return;
    }

    if (!hasFinalizer(store)) {
      await addFinalizer(store);
      log.info('reconcile.finalizer', 'Finalizer added', { storeId });
      return;
    }

    const phase = store.status?.phase;
    const generation = store.metadata.generation;
    const observed = store.status?.observedGeneration;

    if (phase === 'Ready' && generation !== undefined && observed === generation) return;
    if (phase === 'Ready' || phase === 'Failed') return;

    if (isTimedOut(phase, store)) {
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: 'Provisioning timed out after 10 minutes',
      });
      log.warn('reconcile.timeout', 'Provisioning timed out', { storeId });
      return;
    }

    await ensureNamespace(storeId, ns);
    await ensureHelmRelease(storeId, ns);

    if (!(await allPodsReady(ns))) {
      const pods = await getPodsReady(ns);
      await updateStoreStatus(storeId, {
        phase: 'Provisioning',
        message: `Waiting for pods (3/5) — ${pods.ready}/${pods.total} ready`,
      });
      return;
    }

    log.info('reconcile.pods', 'All pods ready', { storeId, namespace: ns });

    if (phase !== 'Verifying') {
      await runWooCommerceSetup(storeId, ns);
    }

    await runVerification(storeId, ns);
    await markReady(storeId, store);

  } catch (err: any) {
    log.error('reconcile.error', `Reconciliation error: ${err.message}`, { storeId });
    reconcileErrors.inc({ phase: store.status?.phase || 'unknown' });
    try {
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: `Unexpected error: ${err.message}`,
      });
    } catch {}
  } finally {
    reconcileDuration.observe((Date.now() - reconcileStart) / 1000);
    activeReconciles.delete(storeId);
  }
}

async function handleDeletion(storeId: string, ns: string, store: Store): Promise<void> {
  await updateStoreStatus(storeId, { phase: 'Deleting', message: 'Tearing down store' });
  log.info('reconcile.delete', 'Deleting store', { storeId });

  await helm.uninstall(storeId, ns);
  await deleteNamespace(ns);
  await removeFinalizer(store);
  log.info('reconcile.delete.done', 'Store deleted', { storeId });
}

function isTimedOut(phase: string | undefined, store: Store): boolean {
  if ((phase !== 'Provisioning' && phase !== 'Configuring') || !store.status?.startedAt) {
    return false;
  }
  const elapsed = Date.now() - new Date(store.status.startedAt).getTime();
  return elapsed > PROVISION_TIMEOUT_MS;
}

async function ensureNamespace(storeId: string, ns: string): Promise<void> {
  if (await namespaceExists(ns)) return;

  await updateStoreStatus(storeId, {
    phase: 'Provisioning',
    message: 'Creating namespace and isolation policies (1/5)',
    startedAt: new Date().toISOString(),
  });
  await createNamespace(ns, storeId);
  await applyResourceQuota(ns);
  await applyNetworkPolicies(ns);
  await applyLimitRange(ns);
  log.info('reconcile.ns', 'Namespace created', { storeId, namespace: ns });
}

async function ensureHelmRelease(storeId: string, ns: string): Promise<void> {
  if (await helm.releaseExists(storeId, ns)) return;

  await updateStoreStatus(storeId, {
    phase: 'Provisioning',
    message: 'Installing WordPress via Helm (2/5)',
  });

  try {
    await helm.install(storeId, ns, {
      'wordpress.ingress.hostname': `${storeId}.127.0.0.1.nip.io`,
    });
    log.info('reconcile.helm', 'Helm release deployed', { storeId, namespace: ns });
  } catch (err: any) {
    await updateStoreStatus(storeId, {
      phase: 'Failed',
      message: `Helm install failed: ${err.message}`,
    });
    throw err;
  }
}

async function runWooCommerceSetup(storeId: string, ns: string): Promise<void> {
  await updateStoreStatus(storeId, {
    phase: 'Configuring',
    message: 'Configuring WooCommerce via WP-CLI (4/5)',
  });

  try {
    await setupWooCommerce(storeId, ns);
  } catch (err: any) {
    await updateStoreStatus(storeId, {
      phase: 'Failed',
      message: `WooCommerce setup failed: ${err.message}`,
    });
    throw err;
  }

  await updateStoreStatus(storeId, {
    phase: 'Verifying',
    message: 'Verifying store health and products (5/5)',
  });
}

async function runVerification(storeId: string, ns: string): Promise<void> {
  let verified: boolean;
  try {
    verified = await verifyStore(storeId, ns);
  } catch (err: any) {
    await updateStoreStatus(storeId, {
      phase: 'Failed',
      message: `Verification error: ${err.message}`,
    });
    throw err;
  }

  if (!verified) {
    await updateStoreStatus(storeId, {
      phase: 'Failed',
      message: 'Store verification failed (HTTP or product check)',
    });
    throw new Error('Verification failed');
  }
}

async function markReady(storeId: string, store: Store): Promise<void> {
  const storeUrl = `http://${storeId}.127.0.0.1.nip.io/shop`;
  const readyAt = new Date().toISOString();

  await updateStoreStatus(storeId, {
    phase: 'Ready',
    message: 'Store is running',
    url: storeUrl,
    readyAt,
    observedGeneration: store.metadata.generation,
  });

  if (store.status?.startedAt) {
    const durationSec = (Date.now() - new Date(store.status.startedAt).getTime()) / 1000;
    provisionDuration.observe(durationSec);
    log.info('reconcile.ready', `Store ready at ${storeUrl} (${durationSec.toFixed(1)}s)`, { storeId });
  } else {
    log.info('reconcile.ready', `Store ready at ${storeUrl}`, { storeId });
  }
}
