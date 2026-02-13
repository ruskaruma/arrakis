import { Router, Request, Response } from 'express';
import { createStore, listStores, getStore, deleteStore, restartStore, upgradeStore, rollbackStoreToRevision, getStoreRevisions, getStoreEvents, getAllEvents, getStoreStats, getStoreCredentials, getStoreMetrics, wcApiRequest } from '../k8s/client';

const router = Router();

const VALID_ENGINES = ['woocommerce', 'medusajs'];
const VALID_TEMPLATES = ['general', 'fashion', 'food', 'electronics', 'beauty', 'sports', 'books'];
const MAX_STORES_PER_USER = 10;

function getOwner(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  return user?.id || 'anonymous';
}

interface AuditEntry {
  timestamp: string;
  action: string;
  storeId: string;
  ip: string;
}

const AUDIT_MAX = 1000;
const auditBuffer: AuditEntry[] = [];

function auditLog(action: string, storeId: string, ip: string | undefined): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    storeId,
    ip: ip || 'unknown',
  };
  auditBuffer.push(entry);
  if (auditBuffer.length > AUDIT_MAX) auditBuffer.shift();
  console.log(JSON.stringify({ ...entry, level: 'audit' }));
}

export function getAuditLog(): AuditEntry[] {
  return [...auditBuffer].reverse();
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function wrap(fn: AsyncHandler): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err: any) => {
      console.error(`${req.method} ${req.path} error:`, err.message);
      const isProduction = process.env.NODE_ENV === 'production';
      res.status(500).json({ error: isProduction ? 'Internal server error' : err.message });
    });
  };
}

async function requireOwnership(req: Request, res: Response): Promise<ReturnType<typeof getStore>> {
  const store = await getStore(req.params.id);
  if (!store) { res.status(404).json({ error: 'Store not found' }); return null; }
  const owner = getOwner(req);
  if (store.owner && store.owner !== owner) { res.status(403).json({ error: 'Not your store' }); return null; }
  return store;
}

router.post('/api/stores', wrap(async (req, res) => {
  const { engine, storeName, template } = req.body;
  if (!engine || !VALID_ENGINES.includes(engine)) {
    res.status(400).json({ error: `engine must be one of: ${VALID_ENGINES.join(', ')}` });
    return;
  }
  if (template && !VALID_TEMPLATES.includes(template)) {
    res.status(400).json({ error: `template must be one of: ${VALID_TEMPLATES.join(', ')}` });
    return;
  }
  if (engine === 'medusajs') {
    res.status(501).json({ error: 'MedusaJS engine coming soon. Currently only WooCommerce is supported.' });
    return;
  }

  const owner = getOwner(req);
  const existing = await listStores(owner);
  if (existing.length >= MAX_STORES_PER_USER) {
    res.status(429).json({ error: `Maximum ${MAX_STORES_PER_USER} stores per user. Delete existing stores first.` });
    return;
  }

  const store = await createStore({ engine, storeName: storeName || undefined, template: template || 'general', owner });
  auditLog('store.created', store.id, req.ip);
  res.status(201).json(store);
}));

router.get('/api/stores', wrap(async (req, res) => {
  const stores = await listStores(getOwner(req));
  res.status(200).json(stores);
}));

router.get('/api/stores/:id', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  res.status(200).json(store);
}));

router.delete('/api/stores/:id', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  await deleteStore(req.params.id);
  auditLog('store.deleted', req.params.id, req.ip);
  res.status(204).send();
}));

router.post('/api/stores/:id/retry', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  if (store.phase !== 'Failed') {
    res.status(400).json({ error: 'Only Failed stores can be retried' });
    return;
  }
  await restartStore(req.params.id);
  auditLog('store.retried', req.params.id, req.ip);
  res.status(202).json({ message: 'Store retry initiated' });
}));

router.post('/api/stores/:id/upgrade', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  if (store.phase !== 'Ready') {
    res.status(400).json({ error: 'Only Ready stores can be upgraded' });
    return;
  }
  const { version, helmValues } = req.body;
  if (!version && !helmValues) {
    res.status(400).json({ error: 'At least one of version or helmValues is required' });
    return;
  }
  if (version && (typeof version !== 'string' || version.length > 32)) {
    res.status(400).json({ error: 'version must be a string of 32 characters or fewer' });
    return;
  }
  if (helmValues && (typeof helmValues !== 'object' || Array.isArray(helmValues))) {
    res.status(400).json({ error: 'helmValues must be an object' });
    return;
  }
  await upgradeStore(req.params.id, { version, helmValues });
  auditLog('store.upgrade', req.params.id, req.ip);
  res.status(202).json({ message: 'Upgrade initiated' });
}));

router.post('/api/stores/:id/rollback', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  if (!['Ready', 'Failed', 'Upgrading'].includes(store.phase)) {
    res.status(400).json({ error: 'Store must be in Ready, Failed, or Upgrading phase to rollback' });
    return;
  }
  const { revision } = req.body || {};
  if (revision !== undefined && (typeof revision !== 'number' || revision < 1)) {
    res.status(400).json({ error: 'revision must be a positive integer' });
    return;
  }
  await rollbackStoreToRevision(req.params.id, revision);
  auditLog('store.rollback', req.params.id, req.ip);
  res.status(202).json({ message: 'Rollback initiated' });
}));

router.get('/api/stores/:id/revisions', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  const revisions = await getStoreRevisions(req.params.id);
  res.status(200).json(revisions);
}));

router.get('/api/stores/:id/credentials', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  const creds = await getStoreCredentials(req.params.id);
  if (!creds) { res.status(404).json({ error: 'Credentials not available yet' }); return; }
  auditLog('credentials.accessed', req.params.id, req.ip);
  res.status(200).json(creds);
}));

router.get('/api/stats', wrap(async (req, res) => {
  const stats = await getStoreStats(getOwner(req));
  res.status(200).json(stats);
}));

router.get('/api/stores/:id/metrics', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  const metrics = await getStoreMetrics(req.params.id);
  res.status(200).json(metrics);
}));

router.get('/api/stores/:id/products', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  const products = await wcApiRequest(req.params.id, 'GET', '/products?per_page=50');
  res.status(200).json(products);
}));

router.post('/api/stores/:id/products', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  const { name, regular_price, images } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const product = await wcApiRequest(req.params.id, 'POST', '/products', {
    name, type: 'simple', regular_price: regular_price || '0', status: 'publish', images: images || [],
  });
  res.status(201).json(product);
}));

router.delete('/api/stores/:id/products/:productId', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  if (!/^\d+$/.test(req.params.productId)) {
    res.status(400).json({ error: 'productId must be a numeric ID' });
    return;
  }
  await wcApiRequest(req.params.id, 'DELETE', `/products/${req.params.productId}?force=true`);
  res.status(204).send();
}));

router.get('/api/stores/:id/events', wrap(async (req, res) => {
  const store = await requireOwnership(req, res);
  if (!store) return;
  const events = await getStoreEvents(req.params.id);
  res.status(200).json(events);
}));

router.get('/api/events', wrap(async (req, res) => {
  const owner = getOwner(req);
  const stores = await listStores(owner);
  const storeIds = new Set(stores.map((s: any) => s.id));
  const events = await getAllEvents();
  const filtered = events.filter((e: any) => storeIds.has(e.storeId));
  res.status(200).json(filtered);
}));

router.get('/api/audit', wrap(async (req, res) => {
  const owner = getOwner(req);
  const stores = await listStores(owner);
  const storeIds = new Set(stores.map((s: any) => s.id));
  const log = getAuditLog().filter(e => storeIds.has(e.storeId));
  res.status(200).json(log);
}));

export default router;
