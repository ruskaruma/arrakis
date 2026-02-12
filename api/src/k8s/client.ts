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

interface CreateStoreOptions {
  engine: string;
  storeName?: string;
  template?: string;
  owner?: string;
}

export async function createStore(options: CreateStoreOptions) {
  const id = `s${crypto.randomBytes(4).toString('hex')}`;

  const spec: Record<string, string> = { engine: options.engine };
  if (options.storeName) spec.storeName = options.storeName;
  if (options.template) spec.template = options.template;
  if (options.owner) spec.owner = options.owner;

  const body = {
    apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
    kind: 'Store',
    metadata: {
      name: id,
      namespace: 'default',
    },
    spec,
  };

  const result = await customApi.createNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
    body,
  });

  const store = result as any;
  return formatStore(store);
}

function formatStore(store: any) {
  return {
    id: store.metadata.name,
    engine: store.spec.engine,
    storeName: store.spec.storeName || null,
    template: store.spec.template || 'general',
    owner: store.spec.owner || null,
    phase: store.status?.phase || 'Pending',
    url: store.status?.url || null,
    message: store.status?.message || null,
    createdAt: store.metadata.creationTimestamp,
    startedAt: store.status?.startedAt || null,
    readyAt: store.status?.readyAt || null,
  };
}

export async function listStores(owner?: string) {
  const result = await customApi.listNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
  });

  let items = (result as any).items || [];
  if (owner) {
    items = items.filter((s: any) => s.spec.owner === owner);
  }
  return items.map(formatStore);
}

export async function getStore(id: string) {
  try {
    const result = await customApi.getNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: 'default',
      plural: CRD_PLURAL,
      name: id,
    });

    return formatStore(result);
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

    const events = (result.items || []).map((event) => ({
      type: event.type || 'Normal',
      reason: event.reason || '',
      message: event.message || '',
      timestamp: (event.lastTimestamp || event.firstTimestamp || new Date()).toISOString(),
      component: event.source?.component || '',
    }));

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, 50);
  } catch (err: any) {
    if (err?.code === 404) return [];
    throw err;
  }
}

export async function getStoreStats(owner?: string) {
  const stores = await listStores(owner);
  const byPhase: Record<string, number> = {};
  let totalProvisionMs = 0;
  let provisionedCount = 0;

  for (const store of stores) {
    byPhase[store.phase] = (byPhase[store.phase] || 0) + 1;
    if (store.startedAt && store.readyAt) {
      totalProvisionMs += new Date(store.readyAt).getTime() - new Date(store.startedAt).getTime();
      provisionedCount++;
    }
  }

  return {
    total: stores.length,
    byPhase,
    avgProvisionMs: provisionedCount > 0 ? Math.round(totalProvisionMs / provisionedCount) : null,
  };
}

export async function getAllEvents() {
  const stores = await listStores();
  const allEvents: Array<{
    type: string; reason: string; message: string;
    timestamp: string; component: string; storeId: string;
  }> = [];

  for (const store of stores) {
    const events = await getStoreEvents(store.id);
    for (const e of events) {
      allEvents.push({ ...e, storeId: store.id });
    }
  }

  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return allEvents.slice(0, 100);
}
