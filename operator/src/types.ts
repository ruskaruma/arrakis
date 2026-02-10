export type StoreEngine = 'woocommerce' | 'medusajs';

export type StorePhase =
  | 'Pending'
  | 'Provisioning'
  | 'Configuring'
  | 'Verifying'
  | 'Ready'
  | 'Failed'
  | 'Deleting';

export interface StoreSpec {
  engine: StoreEngine;
}

export interface StoreStatus {
  phase: StorePhase;
  url?: string;
  message?: string;
  startedAt?: string;
  readyAt?: string;
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
