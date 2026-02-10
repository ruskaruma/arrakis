import * as k8s from '@kubernetes/client-node';
import crypto from 'crypto';

const CRD_GROUP = 'arrakis.io';
const CRD_VERSION = 'v1alpha1';
const CRD_PLURAL = 'stores';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
const coreApi = kc.makeApiClient(k8s.CoreV1Api);

// ─── Create Store ──────────────────────────────────────────────────────────

export async function createStore(engine: string) {
  const id = crypto.randomBytes(4).toString('hex');

  const body = {
    apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
    kind: 'Store',
    metadata: {
      name: id,
      namespace: 'default',
    },
    spec: {
      engine,
    },
  };

  const result = await customApi.createNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
    body,
  });

  const store = result as any;
  return {
    id: store.metadata.name,
    engine: store.spec.engine,
    phase: store.status?.phase || 'Pending',
    url: store.status?.url || null,
    message: store.status?.message || null,
    createdAt: store.metadata.creationTimestamp,
  };
}

// ─── List Stores ───────────────────────────────────────────────────────────

export async function listStores() {
  const result = await customApi.listNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
  });

  const items = (result as any).items || [];
  return items.map((store: any) => ({
    id: store.metadata.name,
    engine: store.spec.engine,
    phase: store.status?.phase || 'Pending',
    url: store.status?.url || null,
    message: store.status?.message || null,
    createdAt: store.metadata.creationTimestamp,
  }));
}

// ─── Get Store ─────────────────────────────────────────────────────────────

export async function getStore(id: string) {
  try {
    const result = await customApi.getNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: 'default',
      plural: CRD_PLURAL,
      name: id,
    });

    const store = result as any;
    return {
      id: store.metadata.name,
      engine: store.spec.engine,
      phase: store.status?.phase || 'Pending',
      url: store.status?.url || null,
      message: store.status?.message || null,
      createdAt: store.metadata.creationTimestamp,
    };
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
}

// ─── Delete Store ──────────────────────────────────────────────────────────

export async function deleteStore(id: string): Promise<boolean> {
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: 'default',
      plural: CRD_PLURAL,
      name: id,
    });
    return true;
  } catch (err: any) {
    if (err?.code === 404) return false;
    throw err;
  }
}

// ─── Get Store Events ──────────────────────────────────────────────────────

export async function getStoreEvents(id: string) {
  try {
    const result = await coreApi.listNamespacedEvent({
      namespace: `store-${id}`,
    });

    return (result.items || []).map((event) => ({
      type: event.type || null,
      reason: event.reason || null,
      message: event.message || null,
      firstTimestamp: event.firstTimestamp || null,
      lastTimestamp: event.lastTimestamp || null,
    }));
  } catch (err: any) {
    if (err?.code === 404) return [];
    throw err;
  }
}
