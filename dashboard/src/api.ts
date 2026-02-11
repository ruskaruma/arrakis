const API_BASE = 'http://localhost:8080';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export async function fetchUser(): Promise<User | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
}

export interface Store {
  id: string;
  engine: string;
  phase: string;
  url: string | null;
  message: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
}

export async function fetchStores(): Promise<Store[]> {
  const res = await fetch(`${API_BASE}/api/stores`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch stores: ${res.status}`);
  return res.json();
}

export async function createStore(engine: string): Promise<Store> {
  const res = await fetch(`${API_BASE}/api/stores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine }),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create store: ${res.status}`);
  }
  return res.json();
}

export async function deleteStore(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/stores/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete store: ${res.status}`);
  }
}

export interface StoreEvent {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  timestamp: string;
  component: string;
  storeId?: string;
}

export async function fetchStoreEvents(id: string): Promise<StoreEvent[]> {
  const res = await fetch(`${API_BASE}/api/stores/${id}/events`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
  return res.json();
}

export async function fetchAllEvents(): Promise<StoreEvent[]> {
  const res = await fetch(`${API_BASE}/api/events`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
  return res.json();
}
