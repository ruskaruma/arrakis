import * as k8s from '@kubernetes/client-node';
import { of } from '@kubernetes/client-node/dist/gen/rxjsStub';
import { Store, CRD_GROUP, CRD_VERSION, CRD_PLURAL, FINALIZER } from './types';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const coreApi = kc.makeApiClient(k8s.CoreV1Api);
export const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
export const watcher = new k8s.Watch(kc);

const MERGE_PATCH: k8s.ConfigurationOptions = {
  middleware: [{
    pre(ctx: k8s.RequestContext) {
      ctx.setHeaderParam('Content-Type', 'application/merge-patch+json');
      return of(ctx);
    },
    post(ctx: k8s.ResponseContext) {
      return of(ctx);
    },
  }],
};

// ─── Namespace ──────────────────────────────────────────────────────────────

export async function namespaceExists(name: string): Promise<boolean> {
  try {
    await coreApi.readNamespace({ name });
    return true;
  } catch (err: any) {
    if (err?.code === 404) return false;
    throw err;
  }
}

export async function createNamespace(name: string, storeId: string): Promise<void> {
  await coreApi.createNamespace({
    body: {
      metadata: {
        name,
        labels: {
          'app.kubernetes.io/managed-by': 'arrakis',
          'arrakis.io/store-id': storeId,
        },
      },
    },
  });
}

export async function deleteNamespace(name: string): Promise<void> {
  try {
    await coreApi.deleteNamespace({ name });
  } catch (err: any) {
    if (err?.code === 404) return;
    throw err;
  }
}

// ─── ResourceQuota ──────────────────────────────────────────────────────────

export async function applyResourceQuota(namespace: string): Promise<void> {
  try {
    await coreApi.createNamespacedResourceQuota({
      namespace,
      body: {
        metadata: { name: 'store-quota', namespace },
        spec: {
          hard: {
            'requests.cpu': '500m',
            'requests.memory': '1Gi',
            'limits.cpu': '2',
            'limits.memory': '3Gi',
            'persistentvolumeclaims': '5',
          },
        },
      },
    });
  } catch (err: any) {
    if (err?.code === 409) return;
    throw err;
  }
}

// ─── Store Status ───────────────────────────────────────────────────────────

export async function updateStoreStatus(
  storeId: string,
  status: Partial<NonNullable<Store['status']>>
): Promise<void> {
  await customApi.patchNamespacedCustomObjectStatus({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
    name: storeId,
    body: { status },
  }, MERGE_PATCH);
}

// ─── Finalizers ─────────────────────────────────────────────────────────────

export function hasFinalizer(store: Store): boolean {
  return (store.metadata.finalizers || []).includes(FINALIZER);
}

export async function addFinalizer(store: Store): Promise<void> {
  const finalizers = [...(store.metadata.finalizers || []), FINALIZER];
  await customApi.patchNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
    name: store.metadata.name,
    body: { metadata: { finalizers } },
  }, MERGE_PATCH);
}

export async function removeFinalizer(store: Store): Promise<void> {
  const finalizers = (store.metadata.finalizers || []).filter(f => f !== FINALIZER);
  await customApi.patchNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: 'default',
    plural: CRD_PLURAL,
    name: store.metadata.name,
    body: { metadata: { finalizers } },
  }, MERGE_PATCH);
}

// ─── Pod Readiness ──────────────────────────────────────────────────────────

export async function getPodsReady(namespace: string): Promise<{ ready: number; total: number }> {
  const res = await coreApi.listNamespacedPod({ namespace });
  const pods = res.items || [];
  const ready = pods.filter(p => {
    const conditions = p.status?.conditions || [];
    return conditions.some(c => c.type === 'Ready' && c.status === 'True');
  }).length;
  return { ready, total: pods.length };
}

export async function allPodsReady(namespace: string): Promise<boolean> {
  const { ready, total } = await getPodsReady(namespace);
  return total > 0 && ready === total;
}
