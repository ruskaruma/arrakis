export type StoreEngine = 'woocommerce' | 'medusajs';
export type StoreTemplate = 'general' | 'fashion' | 'food' | 'electronics' | 'beauty' | 'sports' | 'books';

export type StorePhase =
  | 'Pending'
  | 'Provisioning'
  | 'Configuring'
  | 'Verifying'
  | 'Ready'
  | 'Failed'
  | 'Deleting'
  | 'Upgrading'
  | 'RollingBack';

export interface StoreSpec {
  engine: StoreEngine;
  storeName?: string;
  template?: StoreTemplate;
  owner?: string;
  version?: string;
  helmValues?: Record<string, unknown>;
}

export interface StoreStatus {
  phase: StorePhase;
  url?: string;
  message?: string;
  startedAt?: string;
  readyAt?: string;
  observedGeneration?: number;
  retryCount?: number;
  helmRevision?: number;
  lastUpgradedAt?: string;
  rollbackRevision?: number;
}

export interface Store {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    deletionTimestamp?: string;
    finalizers?: string[];
    resourceVersion?: string;
    generation?: number;
    uid?: string;
  };
  spec: StoreSpec;
  status?: StoreStatus;
}

export const CRD_GROUP = 'arrakis.io';
export const CRD_VERSION = 'v1alpha1';
export const CRD_PLURAL = 'stores';
export const FINALIZER = 'arrakis.io/store-cleanup';
export const STORE_NAMESPACE_PREFIX = 'store-';

export function storeNamespace(storeId: string): string {
  return `${STORE_NAMESPACE_PREFIX}${storeId}`;
}
