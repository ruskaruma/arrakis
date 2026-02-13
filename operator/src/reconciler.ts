import * as path from 'path';
import { Store, StoreTemplate, storeNamespace } from './types';
import {
  namespaceExists, createNamespace, deleteNamespace, applyResourceQuota,
  applyNetworkPolicies, applyLimitRange,
  updateStoreStatus, allPodsReady, getPodsReady,
  hasFinalizer, addFinalizer, removeFinalizer,
  coreApi,
} from './k8s-helpers';
import { HelmManager } from './helm-manager';
import { setupWooCommerce } from './woocommerce-setup';
import { verifyStore } from './store-verifier';
import { log } from './logger';

const MAX_RETRIES = 3;
const PROVISION_TIMEOUT_MS = 10 * 60 * 1_000;
const CHART_PATH = path.resolve(__dirname, '../../helm-charts/woocommerce');
const VALUES_FILE = path.resolve(CHART_PATH, 'values-local.yaml');

const STORE_BASE_DOMAIN = process.env.STORE_BASE_DOMAIN || '127.0.0.1.nip.io';

const helm = new HelmManager(CHART_PATH, VALUES_FILE);
const activeReconciles = new Set<string>();

async function emitEvent(store: Store, reason: string, message: string, type: 'Normal' | 'Warning' = 'Normal'): Promise<void> {
  try {
    await coreApi.createNamespacedEvent({
      namespace: 'default',
      body: {
        metadata: { generateName: `${store.metadata.name}-` },
        involvedObject: {
          kind: 'Store',
          name: store.metadata.name,
          namespace: 'default',
          apiVersion: 'arrakis.io/v1alpha1',
          uid: store.metadata.uid,
        },
        reason,
        message,
        type,
        firstTimestamp: new Date(),
        reportingComponent: 'arrakis-operator',
        reportingInstance: 'arrakis-operator',
      },
    });
  } catch {
    // Event emission is best-effort
  }
}

export async function reconcile(store: Store): Promise<void> {
  const storeId = store.metadata.name;
  const ns = storeNamespace(storeId);

  if (activeReconciles.has(storeId)) return;
  activeReconciles.add(storeId);

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

    // Rollback command takes priority over everything
    if (store.status?.rollbackRevision) {
      await handleRollback(store, storeId, ns, store.status.rollbackRevision);
      return;
    }

    const phase = store.status?.phase;
    const generation = store.metadata.generation;
    const observed = store.status?.observedGeneration;

    // Ready store with spec change → upgrade
    if (phase === 'Ready' && generation !== undefined && observed !== undefined && generation > observed) {
      await handleUpgrade(store, storeId, ns);
      return;
    }

    if (phase === 'Ready' && generation !== undefined && observed === generation) return;
    if (phase === 'Ready') return;
    if (phase === 'Upgrading' || phase === 'RollingBack') return;
    if (phase === 'Failed' && (store.status?.retryCount || 0) >= MAX_RETRIES) return;

    if (isTimedOut(phase, store)) {
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: 'Provisioning timed out after 10 minutes',
      });
      await emitEvent(store, 'ProvisionTimeout', 'Provisioning timed out after 10 minutes', 'Warning');
      log.warn('reconcile.timeout', 'Provisioning timed out', { storeId });
      return;
    }

    await ensureNamespace(storeId, ns);
    await ensureHelmRelease(store, storeId, ns);

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
      await runWooCommerceSetup(store, storeId, ns, store.spec.template, store.spec.storeName);
    }

    await runVerification(storeId, ns);
    await markReady(storeId, store);

  } catch (err: any) {
    const retryCount = (store.status?.retryCount || 0) + 1;
    log.error('reconcile.error', `Reconciliation error (retry ${retryCount}/${MAX_RETRIES}): ${err.message}`, { storeId });
    try {
      if (retryCount >= MAX_RETRIES) {
        await updateStoreStatus(storeId, {
          phase: 'Failed',
          message: `Failed after ${MAX_RETRIES} retries: ${err.message}`,
          retryCount,
        });
      } else {
        await updateStoreStatus(storeId, {
          phase: 'Pending',
          message: `Retry ${retryCount}/${MAX_RETRIES}: ${err.message}`,
          retryCount,
        });
        await emitEvent(store, 'RetryReconcile', `Retry ${retryCount}/${MAX_RETRIES}: ${err.message}`, 'Warning');
        log.info('reconcile.retry', `Will retry (${retryCount}/${MAX_RETRIES})`, { storeId });
      }
    } catch (statusErr: any) {
      log.error('reconcile.status.error', `Failed to update status: ${statusErr.message}`, { storeId });
    }
  } finally {
    activeReconciles.delete(storeId);
  }
}

async function handleDeletion(storeId: string, ns: string, store: Store): Promise<void> {
  await updateStoreStatus(storeId, { phase: 'Deleting', message: 'Tearing down store' });
  await emitEvent(store, 'PhaseTransition', 'Store entered Deleting phase');
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

async function ensureHelmRelease(store: Store, storeId: string, ns: string): Promise<void> {
  const release = await helm.releaseStatus(storeId, ns);

  if (release?.status === 'deployed') return;

  if (release?.status === 'failed') {
    await recoverFailedRelease(store, storeId, ns, release.revision);
    return;
  }

  await updateStoreStatus(storeId, {
    phase: 'Provisioning',
    message: 'Installing WordPress via Helm (2/5)',
  });

  await helm.install(storeId, ns, {
    'wordpress.ingress.hostname': `${storeId}.${STORE_BASE_DOMAIN}`,
  });
  await emitEvent(store, 'HelmInstall', 'Helm release installed successfully');
  log.info('reconcile.helm', 'Helm release deployed', { storeId, namespace: ns });
}

async function recoverFailedRelease(store: Store, storeId: string, ns: string, revision: number): Promise<void> {
  if (revision > 1) {
    log.info('reconcile.helm.rollback', 'Rolling back to previous good revision', { storeId });
    await helm.rollback(storeId, ns);
    await emitEvent(store, 'HelmRollback', `Rolled back to revision ${revision - 1}`, 'Warning');
  } else {
    log.info('reconcile.helm.cleanup', 'Removing failed first install', { storeId });
    await helm.uninstall(storeId, ns);
    await emitEvent(store, 'HelmCleanup', 'Removed failed first install for retry', 'Warning');
  }
}

async function runWooCommerceSetup(store: Store, storeId: string, ns: string, template?: StoreTemplate, storeName?: string): Promise<void> {
  await updateStoreStatus(storeId, {
    phase: 'Configuring',
    message: 'Configuring WooCommerce via WP-CLI (4/5)',
  });
  await emitEvent(store, 'PhaseTransition', 'Store entered Configuring phase');

  await setupWooCommerce({ storeId, namespace: ns, template: template || 'general', storeName });

  await updateStoreStatus(storeId, {
    phase: 'Verifying',
    message: 'Verifying store health and products (5/5)',
  });
  await emitEvent(store, 'PhaseTransition', 'Store entered Verifying phase');
}

async function runVerification(storeId: string, ns: string): Promise<void> {
  const verified = await verifyStore(storeId, ns);
  if (!verified) {
    throw new Error('Store verification failed (HTTP or product check)');
  }
}

async function handleUpgrade(store: Store, storeId: string, ns: string): Promise<void> {
  log.info('reconcile.upgrade', 'Starting upgrade', { storeId });
  await updateStoreStatus(storeId, {
    phase: 'Upgrading',
    message: 'Upgrading Helm release',
  });
  await emitEvent(store, 'UpgradeStarted', 'Helm upgrade started');

  const sets: Record<string, string> = {};
  if (store.spec.version) sets['image.tag'] = store.spec.version;
  if (store.spec.helmValues) {
    for (const [k, v] of Object.entries(store.spec.helmValues)) {
      sets[k] = String(v);
    }
  }

  try {
    await helm.upgrade(storeId, ns, sets);
    const releaseInfo = await helm.releaseStatus(storeId, ns);
    await updateStoreStatus(storeId, {
      phase: 'Ready',
      message: 'Upgrade completed successfully',
      observedGeneration: store.metadata.generation,
      helmRevision: releaseInfo?.revision,
      lastUpgradedAt: new Date().toISOString(),
    });
    await emitEvent(store, 'UpgradeSucceeded', `Upgraded to revision ${releaseInfo?.revision}`);
    log.info('reconcile.upgrade.done', 'Upgrade succeeded', { storeId, revision: releaseInfo?.revision });
  } catch (err: any) {
    log.error('reconcile.upgrade.failed', `Upgrade failed: ${err.message}`, { storeId });
    await emitEvent(store, 'UpgradeFailed', `Upgrade failed: ${err.message}`, 'Warning');

    // Auto-rollback to previous revision
    try {
      log.info('reconcile.upgrade.autorollback', 'Auto-rolling back after failed upgrade', { storeId });
      await helm.rollback(storeId, ns);
      const releaseInfo = await helm.releaseStatus(storeId, ns);
      await updateStoreStatus(storeId, {
        phase: 'Ready',
        message: `Upgrade failed, auto-rolled back: ${err.message}`,
        observedGeneration: store.metadata.generation,
        helmRevision: releaseInfo?.revision,
      });
      await emitEvent(store, 'AutoRollback', 'Auto-rolled back after failed upgrade', 'Warning');
      log.info('reconcile.upgrade.autorollback.done', 'Auto-rollback succeeded', { storeId });
    } catch (rollbackErr: any) {
      log.error('reconcile.upgrade.autorollback.failed', `Auto-rollback also failed: ${rollbackErr.message}`, { storeId });
      await updateStoreStatus(storeId, {
        phase: 'Failed',
        message: `Upgrade failed and auto-rollback failed: ${err.message}`,
        observedGeneration: store.metadata.generation,
      });
    }
  }
}

async function handleRollback(store: Store, storeId: string, ns: string, targetRevision: number): Promise<void> {
  log.info('reconcile.rollback', `Rolling back to revision ${targetRevision}`, { storeId });

  // Clear rollbackRevision immediately to prevent re-triggering
  await updateStoreStatus(storeId, {
    phase: 'RollingBack',
    message: `Rolling back to revision ${targetRevision}`,
    rollbackRevision: 0,
  });
  await emitEvent(store, 'RollbackStarted', `Rolling back to revision ${targetRevision}`);

  try {
    await helm.rollback(storeId, ns, targetRevision);
    const releaseInfo = await helm.releaseStatus(storeId, ns);
    await updateStoreStatus(storeId, {
      phase: 'Ready',
      message: `Rolled back successfully to revision ${targetRevision}`,
      observedGeneration: store.metadata.generation,
      helmRevision: releaseInfo?.revision,
      lastUpgradedAt: new Date().toISOString(),
    });
    await emitEvent(store, 'RollbackSucceeded', `Rolled back to revision ${targetRevision}, now at revision ${releaseInfo?.revision}`);
    log.info('reconcile.rollback.done', 'Rollback succeeded', { storeId, revision: releaseInfo?.revision });
  } catch (err: any) {
    log.error('reconcile.rollback.failed', `Rollback failed: ${err.message}`, { storeId });
    await updateStoreStatus(storeId, {
      phase: 'Failed',
      message: `Rollback to revision ${targetRevision} failed: ${err.message}`,
    });
    await emitEvent(store, 'RollbackFailed', `Rollback failed: ${err.message}`, 'Warning');
  }
}

async function markReady(storeId: string, store: Store): Promise<void> {
  const storeUrl = `http://${storeId}.${STORE_BASE_DOMAIN}/shop`;
  const readyAt = new Date().toISOString();
  const ns = storeNamespace(storeId);
  const releaseInfo = await helm.releaseStatus(storeId, ns);

  await updateStoreStatus(storeId, {
    phase: 'Ready',
    message: 'Store is running',
    url: storeUrl,
    readyAt,
    observedGeneration: store.metadata.generation,
    helmRevision: releaseInfo?.revision,
  });
  await emitEvent(store, 'PhaseTransition', `Store is ready at ${storeUrl}`);

  if (store.status?.startedAt) {
    const durationSec = (Date.now() - new Date(store.status.startedAt).getTime()) / 1000;
    log.info('reconcile.ready', `Store ready at ${storeUrl} (${durationSec.toFixed(1)}s)`, { storeId });
  } else {
    log.info('reconcile.ready', `Store ready at ${storeUrl}`, { storeId });
  }
}
