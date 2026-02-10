import { Router, Request, Response } from 'express';
import { createStore, listStores, getStore, deleteStore, getStoreEvents } from '../k8s/client';

const router = Router();

const VALID_ENGINES = ['woocommerce', 'medusajs'];

// POST /api/stores
router.post('/api/stores', async (req: Request, res: Response) => {
  try {
    const { engine } = req.body;
    if (!engine || !VALID_ENGINES.includes(engine)) {
      res.status(400).json({ error: `engine must be one of: ${VALID_ENGINES.join(', ')}` });
      return;
    }

    const store = await createStore(engine);
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

export default router;
