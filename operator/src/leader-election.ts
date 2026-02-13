import * as k8s from '@kubernetes/client-node';
import * as os from 'os';
import { log } from './logger';

const LEASE_NAME = 'arrakis-operator-leader';
const LEASE_NAMESPACE = 'default';
const LEASE_DURATION_SEC = 15;
const RENEW_INTERVAL_MS = 10_000;
const RETRY_INTERVAL_MS = 2_000;

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
// Use CustomObjectsApi to avoid typed serializer stripping microsecond precision
// from acquireTime/renewTime (CoordinationV1Api serializes Date fields via
// new Date(str).toISOString() which loses microseconds → K8s rejects the timestamp)
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
const LEASE_GROUP = 'coordination.k8s.io';
const LEASE_VERSION = 'v1';
const LEASE_PLURAL = 'leases';

const identity = `${os.hostname()}-${process.pid}`;

interface LeaseObject {
  metadata?: { name?: string; namespace?: string; resourceVersion?: string };
  spec?: {
    holderIdentity?: string;
    leaseDurationSeconds?: number;
    acquireTime?: string;
    renewTime?: string;
  };
}

let renewTimer: NodeJS.Timeout | null = null;
let isLeader = false;

/** K8s MicroTime requires 6-digit microsecond precision */
function microTime(): string {
  const iso = new Date().toISOString();           // 2026-02-13T06:37:14.953Z
  return iso.replace(/\.(\d{3})Z$/, '.$1000Z');   // 2026-02-13T06:37:14.953000Z
}

function leaseExpired(lease: LeaseObject): boolean {
  const renewTime = lease.spec?.renewTime;
  if (!renewTime) return true;
  const elapsed = Date.now() - new Date(renewTime).getTime();
  return elapsed > LEASE_DURATION_SEC * 1000;
}

async function readLease(): Promise<LeaseObject> {
  return customApi.getNamespacedCustomObject({
    group: LEASE_GROUP, version: LEASE_VERSION, namespace: LEASE_NAMESPACE,
    plural: LEASE_PLURAL, name: LEASE_NAME,
  }) as Promise<LeaseObject>;
}

async function replaceLease(lease: LeaseObject): Promise<void> {
  await customApi.replaceNamespacedCustomObject({
    group: LEASE_GROUP, version: LEASE_VERSION, namespace: LEASE_NAMESPACE,
    plural: LEASE_PLURAL, name: LEASE_NAME, body: lease,
  });
}

async function tryAcquire(): Promise<boolean> {
  try {
    const lease = await readLease();
    if (lease.spec?.holderIdentity === identity) return true;
    if (!leaseExpired(lease)) return false;

    lease.spec = {
      ...lease.spec,
      holderIdentity: identity,
      leaseDurationSeconds: LEASE_DURATION_SEC,
      acquireTime: microTime(),
      renewTime: microTime(),
    };
    await replaceLease(lease);
    return true;
  } catch (err: any) {
    if (err?.response?.statusCode === 404 || err?.code === 404) return createLease();
    if (err?.response?.statusCode === 409 || err?.code === 409) return false;
    log.warn('leader.acquire.error', `Lease acquire error: ${err.message}`);
    return false;
  }
}

async function createLease(): Promise<boolean> {
  try {
    await customApi.createNamespacedCustomObject({
      group: LEASE_GROUP, version: LEASE_VERSION,
      namespace: LEASE_NAMESPACE, plural: LEASE_PLURAL,
      body: {
        apiVersion: `${LEASE_GROUP}/${LEASE_VERSION}`,
        kind: 'Lease',
        metadata: { name: LEASE_NAME, namespace: LEASE_NAMESPACE },
        spec: {
          holderIdentity: identity,
          leaseDurationSeconds: LEASE_DURATION_SEC,
          acquireTime: microTime(),
          renewTime: microTime(),
        },
      },
    });
    return true;
  } catch (err: any) {
    if (err?.response?.statusCode === 409 || err?.code === 409) return false;
    throw err;
  }
}

async function renewLease(): Promise<boolean> {
  try {
    const lease = await readLease();
    if (lease.spec?.holderIdentity !== identity) return false;

    lease.spec.renewTime = microTime();
    await replaceLease(lease);
    return true;
  } catch (err: any) {
    if (err?.response?.statusCode === 409 || err?.code === 409) return false;
    log.warn('leader.renew.error', `Lease renew failed: ${err.message}`);
    return false;
  }
}

export async function startLeaderElection(
  onBecomeLeader: () => void,
  onLoseLeadership: () => void,
): Promise<void> {
  log.info('leader.start', `Starting leader election as ${identity}`);

  async function tick(): Promise<void> {
    const wasLeader = isLeader;

    if (isLeader) {
      isLeader = await renewLease();
    } else {
      isLeader = await tryAcquire();
    }

    if (isLeader && !wasLeader) {
      log.info('leader.elected', `Became leader: ${identity}`);
      onBecomeLeader();
    } else if (!isLeader && wasLeader) {
      log.warn('leader.lost', `Lost leadership: ${identity}`);
      onLoseLeadership();
    }

    const delay = isLeader ? RENEW_INTERVAL_MS : RETRY_INTERVAL_MS;
    renewTimer = setTimeout(tick, delay);
  }

  await tick();
}

export function stopLeaderElection(): void {
  if (renewTimer) {
    clearTimeout(renewTimer);
    renewTimer = null;
  }
}

export function currentlyLeading(): boolean {
  return isLeader;
}
