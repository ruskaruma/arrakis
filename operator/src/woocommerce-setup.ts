import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from './logger';

const execFileAsync = promisify(execFile);

const CMD_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per command

async function kubectlExec(storeId: string, namespace: string, command: string[]): Promise<string> {
  const { stdout } = await execFileAsync('kubectl', [
    'exec', `deploy/${storeId}-wordpress`,
    '-n', namespace,
    '--',
    ...command,
  ], { timeout: CMD_TIMEOUT_MS });
  return stdout;
}

export async function setupWooCommerce(storeId: string, namespace: string): Promise<void> {
  log.info('wpcli.setup.start', 'Starting WooCommerce setup', { storeId, namespace });

  // 1. Install and activate WooCommerce plugin
  log.info('wpcli.plugin.install', 'Installing WooCommerce plugin', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'plugin', 'install', 'woocommerce', '--activate', '--allow-root',
  ]);
  log.info('wpcli.plugin.done', 'WooCommerce plugin installed and activated', { storeId });

  // 2. Create sample product
  log.info('wpcli.product.create', 'Creating sample product', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'wc', 'product', 'create',
    '--name=Arrakis Spice Blend',
    '--type=simple',
    '--regular_price=42.00',
    '--status=publish',
    '--user=user',
    '--allow-root',
  ]);
  log.info('wpcli.product.done', 'Sample product created', { storeId });

  // 3. Enable Cash on Delivery payment method
  log.info('wpcli.cod.enable', 'Enabling Cash on Delivery', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'option', 'update', 'woocommerce_cod_settings',
    '{"enabled":"yes","title":"Cash on Delivery"}',
    '--format=json',
    '--allow-root',
  ]);
  log.info('wpcli.cod.done', 'Cash on Delivery enabled', { storeId });

  log.info('wpcli.setup.done', 'WooCommerce setup complete', { storeId });
}
