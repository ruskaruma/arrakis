import * as k8s from '@kubernetes/client-node';
import { of } from '@kubernetes/client-node/dist/gen/rxjsStub';
import crypto from 'crypto';
import { spawn } from 'child_process';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
const coreApi = kc.makeApiClient(k8s.CoreV1Api);

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

const CRD = { group: 'arrakis.io', version: 'v1alpha1', namespace: 'default' as const, plural: 'stores' };

function storeNs(id: string): string {
  return `store-${id}`;
}

interface CreateStoreOptions {
  engine: string;
  storeName?: string;
  template?: string;
  owner?: string;
}

interface StoreResource {
  metadata: { name: string; creationTimestamp: string };
  spec: { engine: string; storeName?: string; template?: string; owner?: string; version?: string };
  status?: {
    phase?: string; url?: string; message?: string;
    startedAt?: string; readyAt?: string;
    helmRevision?: number; lastUpgradedAt?: string;
  };
}

function formatStore(store: StoreResource) {
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
    version: store.spec.version || null,
    helmRevision: store.status?.helmRevision || null,
    lastUpgradedAt: store.status?.lastUpgradedAt || null,
  };
}

export async function createStore(options: CreateStoreOptions) {
  const id = `s${crypto.randomBytes(4).toString('hex')}`;

  const spec: Record<string, string> = { engine: options.engine };
  if (options.storeName) spec.storeName = options.storeName;
  if (options.template) spec.template = options.template;
  if (options.owner) spec.owner = options.owner;

  const result = await customApi.createNamespacedCustomObject({
    ...CRD,
    body: {
      apiVersion: `${CRD.group}/${CRD.version}`,
      kind: 'Store',
      metadata: { name: id, namespace: 'default' },
      spec,
    },
  });

  return formatStore(result as StoreResource);
}

export async function listStores(owner?: string) {
  const result = await customApi.listNamespacedCustomObject(CRD);

  let items: StoreResource[] = ((result as { items?: StoreResource[] }).items) || [];
  if (owner) {
    items = items.filter((s) => s.spec.owner === owner);
  }
  return items.map(formatStore);
}

export async function getStore(id: string) {
  try {
    const result = await customApi.getNamespacedCustomObject({ ...CRD, name: id });
    return formatStore(result as StoreResource);
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
}

export async function deleteStore(id: string): Promise<boolean> {
  try {
    await customApi.deleteNamespacedCustomObject({ ...CRD, name: id });
    return true;
  } catch (err: any) {
    if (err?.code === 404) return false;
    throw err;
  }
}

export async function restartStore(id: string): Promise<void> {
  await customApi.patchNamespacedCustomObjectStatus({
    group: CRD.group, version: CRD.version, namespace: CRD.namespace, plural: CRD.plural,
    name: id, body: { status: { phase: 'Pending', message: 'Retry requested', retryCount: 0 } },
  }, MERGE_PATCH);
}

export async function upgradeStore(id: string, options: { version?: string; helmValues?: Record<string, unknown> }) {
  const patch: Record<string, unknown> = {};
  if (options.version !== undefined) patch.version = options.version;
  if (options.helmValues !== undefined) patch.helmValues = options.helmValues;

  await customApi.patchNamespacedCustomObject({
    group: CRD.group, version: CRD.version, namespace: CRD.namespace, plural: CRD.plural,
    name: id, body: { spec: patch },
  }, MERGE_PATCH);
}

export async function rollbackStoreToRevision(id: string, revision?: number) {
  await customApi.patchNamespacedCustomObjectStatus({
    group: CRD.group, version: CRD.version, namespace: CRD.namespace, plural: CRD.plural,
    name: id, body: { status: { rollbackRevision: revision || 0 } },
  }, MERGE_PATCH);
}

export interface HelmRevision {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export async function getStoreRevisions(id: string): Promise<HelmRevision[]> {
  const ns = storeNs(id);
  return new Promise((resolve) => {
    const proc = spawn('helm', ['history', id, '--namespace', ns, '-o', 'json', '--max', '20']);
    let stdout = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.resume();
    proc.on('error', () => resolve([]));
    proc.on('close', (code: number | null) => {
      if (code !== 0) { resolve([]); return; }
      try {
        const parsed: HelmRevision[] = JSON.parse(stdout);
        resolve(parsed.map((r) => ({
          revision: r.revision,
          updated: r.updated,
          status: r.status,
          chart: r.chart,
          app_version: r.app_version,
          description: r.description,
        })));
      } catch {
        resolve([]);
      }
    });
  });
}

export async function getStoreEvents(id: string) {
  const namespaces = ['default', storeNs(id)];
  const allEvents: Array<{
    type: string; reason: string; message: string;
    timestamp: string; component: string;
  }> = [];

  for (const ns of namespaces) {
    try {
      const result = await coreApi.listNamespacedEvent({ namespace: ns });
      for (const event of result.items || []) {
        const involvedName = event.involvedObject?.name || '';
        if (ns === 'default' && !involvedName.startsWith(id)) continue;
        allEvents.push({
          type: event.type || 'Normal',
          reason: event.reason || '',
          message: event.message || '',
          timestamp: (event.lastTimestamp || event.firstTimestamp || new Date()).toISOString(),
          component: event.source?.component || event.reportingComponent || '',
        });
      }
    } catch (err: any) {
      if (err?.code !== 404) throw err;
    }
  }

  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return allEvents.slice(0, 50);
}

export async function getStoreCredentials(id: string) {
  const ns = storeNs(id);
  try {
    const secret = await coreApi.readNamespacedSecret({ name: `${id}-wordpress`, namespace: ns });
    const password = secret.data?.['wordpress-password']
      ? Buffer.from(secret.data['wordpress-password'], 'base64').toString('utf-8')
      : null;
    return { username: 'user', password };
  } catch (err: any) {
    if (err?.code === 404) return null;
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

export async function getStoreMetrics(id: string) {
  const ns = storeNs(id);
  const pods: Array<{ name: string; phase: string; ready: boolean; cpu?: string; memory?: string }> = [];
  let storageTotalBytes = 0;

  try {
    const podList = await coreApi.listNamespacedPod({ namespace: ns });
    for (const pod of podList.items) {
      const ready = (pod.status?.containerStatuses || []).every(c => c.ready);
      pods.push({
        name: pod.metadata?.name || '',
        phase: pod.status?.phase || 'Unknown',
        ready,
      });
    }
  } catch {
    // Pod listing may fail if namespace is still provisioning
  }

  try {
    const podMetrics = await customApi.listNamespacedCustomObject({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      namespace: ns,
      plural: 'pods',
    }) as any;

    for (const m of podMetrics.items || []) {
      const podEntry = pods.find(p => p.name === m.metadata?.name);
      if (podEntry && m.containers) {
        let cpuNano = 0;
        let memBytes = 0;
        for (const c of m.containers) {
          cpuNano += parseCpu(c.usage?.cpu || '0');
          memBytes += parseMem(c.usage?.memory || '0');
        }
        podEntry.cpu = `${Math.round(cpuNano / 1_000_000)}m`;
        podEntry.memory = formatBytes(memBytes);
      }
    }
  } catch {
    // Metrics API may not be available (requires metrics-server)
  }

  try {
    const pvcList = await coreApi.listNamespacedPersistentVolumeClaim({ namespace: ns });
    for (const pvc of pvcList.items) {
      const capacity = pvc.status?.capacity?.['storage'];
      const requested = pvc.spec?.resources?.requests?.['storage'];
      if (capacity) storageTotalBytes += parseMem(capacity);
      else if (requested) storageTotalBytes += parseMem(requested);
    }
  } catch {
    // PVC listing may fail if namespace is still provisioning
  }

  return {
    pods,
    storage: {
      total: formatBytes(storageTotalBytes),
    },
  };
}

function parseCpu(val: string): number {
  if (val.endsWith('n')) return parseInt(val, 10);
  if (val.endsWith('u')) return parseInt(val, 10) * 1000;
  if (val.endsWith('m')) return parseInt(val, 10) * 1_000_000;
  return parseFloat(val) * 1_000_000_000;
}

function parseMem(val: string): number {
  const units: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1000, M: 1e6, G: 1e9 };
  for (const [suffix, multiplier] of Object.entries(units)) {
    if (val.endsWith(suffix)) return parseFloat(val) * multiplier;
  }
  return parseFloat(val);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} Ki`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mi`;
  return `${(bytes / 1024 ** 3).toFixed(1)} Gi`;
}

export async function getWcApiKeys(id: string): Promise<{ consumerKey: string; consumerSecret: string } | null> {
  const ns = storeNs(id);
  try {
    const secret = await coreApi.readNamespacedSecret({ name: `${id}-wc-api`, namespace: ns });
    const ck = secret.data?.['consumer_key']
      ? Buffer.from(secret.data['consumer_key'], 'base64').toString('utf-8')
      : null;
    const cs = secret.data?.['consumer_secret']
      ? Buffer.from(secret.data['consumer_secret'], 'base64').toString('utf-8')
      : null;
    if (!ck || !cs) return null;
    return { consumerKey: ck, consumerSecret: cs };
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
}

export async function wcApiRequest(id: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const keys = await getWcApiKeys(id);
  if (!keys) throw new Error('WooCommerce API keys not available');

  const store = await getStore(id);
  if (!store?.url) throw new Error('Store URL not available');

  const baseUrl = store.url.replace(/\/shop$/, '');
  const url = `${baseUrl}/wp-json/wc/v3${path}`;
  const credentials = Buffer.from(`${keys.consumerKey}:${keys.consumerSecret}`).toString('base64');

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WC API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
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
