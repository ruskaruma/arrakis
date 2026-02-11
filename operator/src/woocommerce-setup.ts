import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from './logger';

const execFileAsync = promisify(execFile);

const CMD_TIMEOUT_MS = 2 * 60 * 1000;

async function kubectlExec(storeId: string, namespace: string, command: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('kubectl', [
    'exec', `deploy/${storeId}-wordpress`,
    '-n', namespace,
    '--',
    ...command,
  ], { timeout: CMD_TIMEOUT_MS });
  if (stderr.trim()) {
    log.warn('kubectlExec.stderr', stderr.trim(), { storeId, command: command.join(' ') });
  }
  return stdout;
}

export async function setupWooCommerce(storeId: string, namespace: string): Promise<void> {
  log.info('wpcli.setup.start', 'Starting WooCommerce setup', { storeId, namespace });

  log.info('wpcli.plugin.install', 'Installing WooCommerce plugin', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'plugin', 'install', 'woocommerce', '--activate', '--allow-root',
  ]);
  log.info('wpcli.plugin.done', 'WooCommerce plugin installed and activated', { storeId });

  const existingProducts = (await kubectlExec(storeId, namespace, [
    'wp', 'wc', 'product', 'list', '--search=Arrakis Spice Blend', '--field=id', '--user=user', '--allow-root',
  ])).trim();

  if (!existingProducts) {
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
  } else {
    log.info('wpcli.product.skip', 'Sample product already exists, skipping', { storeId });
  }

  log.info('wpcli.cod.enable', 'Enabling Cash on Delivery', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'option', 'update', 'woocommerce_cod_settings',
    '{"enabled":"yes","title":"Cash on Delivery"}',
    '--format=json',
    '--allow-root',
  ]);
  log.info('wpcli.cod.done', 'Cash on Delivery enabled', { storeId });

  log.info('wpcli.homepage.set', 'Setting shop as homepage', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'option', 'update', 'show_on_front', 'page', '--allow-root',
  ]);
  const shopPageId = (await kubectlExec(storeId, namespace, [
    'wp', 'post', 'list', '--post_type=page', '--name=shop', '--field=ID', '--allow-root',
  ])).trim();
  if (shopPageId) {
    await kubectlExec(storeId, namespace, [
      'wp', 'option', 'update', 'page_on_front', shopPageId, '--allow-root',
    ]);
  }
  log.info('wpcli.homepage.done', 'Shop set as homepage', { storeId, shopPageId });

  log.info('wpcli.setup.done', 'WooCommerce setup complete', { storeId });
}
