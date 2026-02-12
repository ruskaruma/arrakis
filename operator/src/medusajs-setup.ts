import { log } from './logger';

/**
 * MedusaJS engine setup module (Q2 2026 roadmap).
 *
 * This follows the same pattern as woocommerce-setup.ts:
 * 1. Wait for pods to be ready
 * 2. Run seed commands via kubectl exec
 * 3. Verify health endpoint
 *
 * The engine dispatch in reconciler.ts routes to the correct setup module
 * based on spec.engine, making new engine support a matter of adding:
 * - A Helm chart in helm-charts/<engine>/
 * - A setup module in operator/src/<engine>-setup.ts
 * - A verifier in operator/src/<engine>-verifier.ts (or extend store-verifier.ts)
 */
export async function setupMedusaJS(storeId: string, namespace: string): Promise<void> {
  log.info('medusa.setup.start', 'MedusaJS setup (stub)', { storeId, namespace });

  // Future implementation:
  // 1. Run Medusa migrations: kubectl exec deploy/<storeId>-medusa -- npx medusa migrations run
  // 2. Seed admin user: kubectl exec deploy/<storeId>-medusa -- npx medusa user -e admin@store.com -p <generated>
  // 3. Seed demo products based on template
  // 4. Configure payment providers
  // 5. Set store settings via Medusa Admin API

  throw new Error('MedusaJS engine is not yet available. Target: Q2 2026.');
}
