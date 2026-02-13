const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

function jsonPost<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface Store {
  id: string;
  engine: string;
  storeName: string | null;
  template: string;
  owner: string | null;
  phase: string;
  url: string | null;
  message: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  version: string | null;
  helmRevision: number | null;
  lastUpgradedAt: string | null;
}

export interface HelmRevision {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export interface CreateStoreOptions {
  engine: string;
  storeName?: string;
  template?: string;
}

export interface StoreEvent {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  timestamp: string;
  component: string;
  storeId?: string;
}

export interface StoreCredentials {
  username: string;
  password: string | null;
}

export interface StoreStats {
  total: number;
  byPhase: Record<string, number>;
  avgProvisionMs: number | null;
}

export interface PodMetrics {
  name: string;
  phase: string;
  ready: boolean;
  cpu?: string;
  memory?: string;
}

export interface StoreMetrics {
  pods: PodMetrics[];
  storage: { total: string; used: string };
}

export interface Product {
  id: number;
  name: string;
  regular_price: string;
  price: string;
  images: Array<{ id: number; src: string }>;
  status: string;
}

export async function fetchUser(): Promise<User | null> {
  try {
    const data = await api<{ user: User | null }>('/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
}

export const fetchStores = () => api<Store[]>('/api/stores');

export const createStore = (options: CreateStoreOptions) => jsonPost<Store>('/api/stores', options);

export async function deleteStore(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/stores/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete: ${res.status}`);
}

export const retryStore = (id: string) => jsonPost<{ message: string }>(`/api/stores/${id}/retry`, {});

/** @deprecated Use retryStore instead */
export const rollbackStore = retryStore;

export const upgradeStore = (id: string, values: { version?: string; helmValues?: Record<string, unknown> }) =>
  jsonPost<{ message: string }>(`/api/stores/${id}/upgrade`, values);

export const rollbackToRevision = (id: string, revision?: number) =>
  jsonPost<{ message: string }>(`/api/stores/${id}/rollback`, revision !== undefined ? { revision } : {});

export const fetchRevisions = (id: string) => api<HelmRevision[]>(`/api/stores/${id}/revisions`);

export const fetchStoreEvents = (id: string) => api<StoreEvent[]>(`/api/stores/${id}/events`);

export async function fetchStoreCredentials(id: string): Promise<StoreCredentials | null> {
  try { return await api<StoreCredentials>(`/api/stores/${id}/credentials`); }
  catch { return null; }
}

export const fetchStats = () => api<StoreStats>('/api/stats');

export async function fetchStoreMetrics(id: string): Promise<StoreMetrics | null> {
  try { return await api<StoreMetrics>(`/api/stores/${id}/metrics`); }
  catch { return null; }
}

export const fetchAllEvents = () => api<StoreEvent[]>('/api/events');

export const fetchProducts = (storeId: string) => api<Product[]>(`/api/stores/${storeId}/products`);

export const createProduct = (storeId: string, data: { name: string; regular_price: string; images?: Array<{ src: string }> }) =>
  jsonPost<Product>(`/api/stores/${storeId}/products`, data);

export async function deleteProduct(storeId: string, productId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/stores/${storeId}/products/${productId}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete product: ${res.status}`);
}
