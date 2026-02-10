import { Router, Request, Response } from 'express';
import { createStore, listStores, getStore, deleteStore, getStoreEvents, getAllEvents } from '../k8s/client';

const router = Router();

const VALID_ENGINES = ['woocommerce', 'medusajs'];

function auditLog(action: string, storeId: string, ip: string | undefined): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    storeId,
    ip: ip || 'unknown',
    level: 'audit',
  }));
}

// POST /api/stores
router.post('/api/stores', async (req: Request, res: Response) => {
  try {
    const { engine } = req.body;
    if (!engine || !VALID_ENGINES.includes(engine)) {
      res.status(400).json({ error: `engine must be one of: ${VALID_ENGINES.join(', ')}` });
      return;
    }

    if (engine === 'medusajs') {
      res.status(501).json({ error: 'MedusaJS engine coming soon. Currently only WooCommerce is supported.' });
      return;
    }

    const existing = await listStores();
    if (existing.length >= 10) {
      res.status(429).json({ error: 'Maximum 10 stores allowed. Delete existing stores first.' });
      return;
    }

    const store = await createStore(engine);
    auditLog('store.created', store.id, req.ip);
    res.status(201).json(store);
  } catch (err: any) {
    console.error('POST /api/stores error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stores
router.get('/api/stores', async (_req: Request, res: Response) => {
  try {
    const stores = await listStores();
    res.status(200).json(stores);
  } catch (err: any) {
    console.error('GET /api/stores error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stores/:id
router.get('/api/stores/:id', async (req: Request, res: Response) => {
  try {
    const store = await getStore(req.params.id);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }
    res.status(200).json(store);
  } catch (err: any) {
    console.error(`GET /api/stores/${req.params.id} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stores/:id
router.delete('/api/stores/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteStore(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }
    auditLog('store.deleted', req.params.id, req.ip);
    res.status(204).send();
  } catch (err: any) {
    console.error(`DELETE /api/stores/${req.params.id} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stores/:id/events
router.get('/api/stores/:id/events', async (req: Request, res: Response) => {
  try {
    const events = await getStoreEvents(req.params.id);
    res.status(200).json(events);
  } catch (err: any) {
    console.error(`GET /api/stores/${req.params.id}/events error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events
router.get('/api/events', async (_req: Request, res: Response) => {
  try {
    const events = await getAllEvents();
    res.status(200).json(events);
  } catch (err: any) {
    console.error('GET /api/events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
