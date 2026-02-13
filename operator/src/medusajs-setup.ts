import { log } from './logger';

export async function setupMedusaJS(storeId: string, namespace: string): Promise<void> {
  log.info('medusa.setup.start', 'MedusaJS setup (stub)', { storeId, namespace });
  throw new Error('MedusaJS engine is not yet available. Target: Q2 2026.');
}
