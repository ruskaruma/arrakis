import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from './logger';
import type { StoreTemplate } from './types';

const execFileAsync = promisify(execFile);

const CMD_TIMEOUT_MS = 2 * 60 * 1000;

interface TemplateProduct {
  name: string;
  price: string;
}

const TEMPLATE_PRODUCTS: Record<StoreTemplate, TemplateProduct[]> = {
  general: [
    { name: 'Arrakis Spice Blend', price: '42.00' },
  ],
  fashion: [
    { name: 'Desert Silk Robe', price: '89.00' },
    { name: 'Stillsuit Jacket', price: '149.00' },
    { name: 'Fremen Sandals', price: '59.00' },
  ],
  food: [
    { name: 'Spice Melange Tea', price: '24.00' },
    { name: 'Arrakeen Coffee Beans', price: '32.00' },
    { name: 'Sietch Bread Mix', price: '12.00' },
  ],
  electronics: [
    { name: 'Holtzman Shield Generator', price: '299.00' },
    { name: 'Ornithopter Navigation Module', price: '199.00' },
    { name: 'Thumper Device', price: '79.00' },
  ],
};

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

export async function setupWooCommerce(storeId: string, namespace: string, template: StoreTemplate = 'general'): Promise<void> {
  log.info('wpcli.setup.start', 'Starting WooCommerce setup', { storeId, namespace, template });

  log.info('wpcli.plugin.install', 'Installing WooCommerce plugin', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'plugin', 'install', 'woocommerce', '--activate', '--allow-root',
  ]);
  log.info('wpcli.plugin.done', 'WooCommerce plugin installed and activated', { storeId });

  const products = TEMPLATE_PRODUCTS[template] || TEMPLATE_PRODUCTS.general;
  const existingCount = (await kubectlExec(storeId, namespace, [
    'wp', 'wc', 'product', 'list', '--format=count', '--user=user', '--allow-root',
  ])).trim();

  if (existingCount === '0') {
    for (const product of products) {
      log.info('wpcli.product.create', `Creating product: ${product.name}`, { storeId });
      await kubectlExec(storeId, namespace, [
        'wp', 'wc', 'product', 'create',
        `--name=${product.name}`,
        '--type=simple',
        `--regular_price=${product.price}`,
        '--status=publish',
        '--user=user',
        '--allow-root',
      ]);
    }
    log.info('wpcli.product.done', `${products.length} products created`, { storeId });
  } else {
    log.info('wpcli.product.skip', 'Products already exist, skipping', { storeId });
  }

  log.info('wpcli.hpos.enable', 'Enabling High-Performance Order Storage', { storeId });
  await kubectlExec(storeId, namespace, [
    'wp', 'option', 'update', 'woocommerce_feature_custom_order_tables_enabled', 'yes', '--allow-root',
  ]);
  await kubectlExec(storeId, namespace, [
    'wp', 'option', 'update', 'woocommerce_custom_orders_table_enabled', 'yes', '--allow-root',
  ]);
  log.info('wpcli.hpos.done', 'HPOS enabled', { storeId });

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
