const API_BASE = 'http://localhost:8080';

export interface Store {
  id: string;
  engine: string;
  phase: string;
  url: string | null;
  message: string | null;
  createdAt: string;
}

export async function fetchStores(): Promise<Store[]> {
  const res = await fetch(`${API_BASE}/api/stores`);
  if (!res.ok) throw new Error(`Failed to fetch stores: ${res.status}`);
  return res.json();
}

export async function createStore(engine: string): Promise<Store> {
  const res = await fetch(`${API_BASE}/api/stores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create store: ${res.status}`);
  }
  return res.json();
}

export async function deleteStore(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/stores/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete store: ${res.status}`);
  }
}
