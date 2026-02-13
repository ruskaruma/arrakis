import * as k8s from '@kubernetes/client-node';
import { of } from '@kubernetes/client-node/dist/gen/rxjsStub';
import { Store, CRD_GROUP, CRD_VERSION, CRD_PLURAL, FINALIZER } from './types';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const coreApi = kc.makeApiClient(k8s.CoreV1Api);
export const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
export const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
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

async function createIfAbsent(fn: () => Promise<any>): Promise<void> {
  try { await fn(); } catch (err: any) { if (err?.code === 409) return; throw err; }
}

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
        labels: { 'app.kubernetes.io/managed-by': 'arrakis', 'arrakis.io/store-id': storeId },
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

export async function applyResourceQuota(namespace: string): Promise<void> {
  await createIfAbsent(() => coreApi.createNamespacedResourceQuota({
    namespace,
    body: {
      metadata: { name: 'store-quota', namespace },
      spec: {
        hard: {
          'requests.cpu': '500m', 'requests.memory': '1Gi',
          'limits.cpu': '2', 'limits.memory': '3Gi',
          'persistentvolumeclaims': '5',
        },
      },
    },
  }));
}

export async function applyNetworkPolicies(namespace: string): Promise<void> {
  const policies: Array<{ name: string; spec: k8s.V1NetworkPolicySpec }> = [
    { name: 'default-deny-ingress', spec: { podSelector: {}, policyTypes: ['Ingress'] } },
    {
      name: 'allow-traefik-ingress',
      spec: {
        podSelector: {}, policyTypes: ['Ingress'],
        ingress: [{ _from: [{
          namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
          podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } },
        }] }],
      },
    },
    {
      name: 'allow-operator-ingress',
      spec: {
        podSelector: {}, policyTypes: ['Ingress'],
        ingress: [{ _from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'default' } } }] }],
      },
    },
    {
      name: 'mariadb-restrict',
      spec: {
        podSelector: { matchLabels: { 'app.kubernetes.io/name': 'mariadb' } },
        policyTypes: ['Ingress'],
        ingress: [{
          _from: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'wordpress' } } }],
          ports: [{ protocol: 'TCP', port: 3306 }],
        }],
      },
    },
    { name: 'default-deny-egress', spec: { podSelector: {}, policyTypes: ['Egress'] } },
    {
      name: 'allow-dns-egress',
      spec: {
        podSelector: {}, policyTypes: ['Egress'],
        egress: [{
          to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }],
          ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }],
        }],
      },
    },
    {
      name: 'allow-internal-egress',
      spec: {
        podSelector: {}, policyTypes: ['Egress'],
        egress: [{ to: [{ podSelector: {} }] }],
      },
    },
    {
      name: 'allow-http-egress',
      spec: {
        podSelector: {}, policyTypes: ['Egress'],
        egress: [{ ports: [{ protocol: 'TCP', port: 80 }, { protocol: 'TCP', port: 443 }] }],
      },
    },
  ];

  for (const policy of policies) {
    await createIfAbsent(() => networkingApi.createNamespacedNetworkPolicy({
      namespace,
      body: { metadata: { name: policy.name, namespace }, spec: policy.spec },
    }));
  }
}

export async function applyLimitRange(namespace: string): Promise<void> {
  await createIfAbsent(() => coreApi.createNamespacedLimitRange({
    namespace,
    body: {
      metadata: { name: 'store-limits', namespace },
      spec: {
        limits: [
          { type: 'Container', _default: { cpu: '500m', memory: '512Mi' }, defaultRequest: { cpu: '100m', memory: '128Mi' } },
          { type: 'PersistentVolumeClaim', max: { storage: '5Gi' } },
        ],
      },
    },
  }));
}

export async function updateStoreStatus(
  storeId: string,
  status: Partial<NonNullable<Store['status']>>,
): Promise<void> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await customApi.patchNamespacedCustomObjectStatus({
        group: CRD_GROUP, version: CRD_VERSION, namespace: 'default', plural: CRD_PLURAL,
        name: storeId, body: { status },
      }, MERGE_PATCH);
      return;
    } catch (err: any) {
      if (err?.code === 409 && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
}

export function hasFinalizer(store: Store): boolean {
  return (store.metadata.finalizers || []).includes(FINALIZER);
}

export async function addFinalizer(store: Store): Promise<void> {
  const finalizers = [...(store.metadata.finalizers || []), FINALIZER];
  await customApi.patchNamespacedCustomObject({
    group: CRD_GROUP, version: CRD_VERSION, namespace: 'default', plural: CRD_PLURAL,
    name: store.metadata.name, body: { metadata: { finalizers } },
  }, MERGE_PATCH);
}

export async function removeFinalizer(store: Store): Promise<void> {
  const finalizers = (store.metadata.finalizers || []).filter(f => f !== FINALIZER);
  await customApi.patchNamespacedCustomObject({
    group: CRD_GROUP, version: CRD_VERSION, namespace: 'default', plural: CRD_PLURAL,
    name: store.metadata.name, body: { metadata: { finalizers } },
  }, MERGE_PATCH);
}

export async function getPodsReady(namespace: string): Promise<{ ready: number; total: number }> {
  const res = await coreApi.listNamespacedPod({ namespace });
  const pods = res.items || [];
  const ready = pods.filter(p =>
    (p.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')
  ).length;
  return { ready, total: pods.length };
}

export async function allPodsReady(namespace: string): Promise<boolean> {
  const { ready, total } = await getPodsReady(namespace);
  return total > 0 && ready === total;
}

export async function createSecret(namespace: string, name: string, data: Record<string, string>): Promise<void> {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) encoded[k] = Buffer.from(v).toString('base64');
  await createIfAbsent(() => coreApi.createNamespacedSecret({
    namespace,
    body: { metadata: { name, namespace }, type: 'Opaque', data: encoded },
  }));
}
