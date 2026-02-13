import { log } from './logger';
import { createSecret } from './k8s-helpers';
import { podExec } from './kubectl';
import type { StoreTemplate } from './types';

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
  beauty: [
    { name: 'Spice Essence Perfume', price: '68.00' },
    { name: 'Desert Rose Skin Oil', price: '45.00' },
    { name: 'Sietch Mineral Soap', price: '18.00' },
  ],
  sports: [
    { name: 'Sandworm Rider Harness', price: '185.00' },
    { name: 'Fremen Combat Training Kit', price: '120.00' },
    { name: 'Desert Running Sandals', price: '75.00' },
  ],
  books: [
    { name: 'The Collected Sayings of Muad\'Dib', price: '32.00' },
    { name: 'Ecology of Dune', price: '28.00' },
    { name: 'The Orange Catholic Bible', price: '55.00' },
  ],
};

function wpCli(storeId: string, ns: string, args: string[]): Promise<string> {
  return podExec(storeId, ns, ['wp', ...args, '--allow-root']);
}

interface SetupOptions {
  storeId: string;
  namespace: string;
  template: StoreTemplate;
  storeName?: string;
}

export async function setupWooCommerce({ storeId, namespace, template, storeName }: SetupOptions): Promise<void> {
  log.info('wpcli.setup.start', 'Starting WooCommerce setup', { storeId, namespace, template });

  await activateWooCommerce(storeId, namespace);
  log.info('wpcli.plugin.done', 'WooCommerce activated', { storeId });

  await wpCli(storeId, namespace, ['option', 'update', 'blogname', storeName || storeId]);
  await wpCli(storeId, namespace, ['option', 'update', 'blogdescription', 'Powered by Arrakis']);

  await configurePermalinks(storeId, namespace);
  await installRestAuthPlugin(storeId, namespace);
  await seedProducts(storeId, namespace, template);
  await configureWooCommerce(storeId, namespace);
  await configureStoreAdmin(storeId, namespace);
  await setShopHomepage(storeId, namespace);
  await cleanupDefaultPages(storeId, namespace);
  await generateWcApiKeys(storeId, namespace);

  log.info('wpcli.setup.done', 'WooCommerce setup complete', { storeId });
}

async function activateWooCommerce(storeId: string, ns: string): Promise<void> {
  // Bitnami WordPress image bundles WooCommerce — try activating it first
  try {
    await wpCli(storeId, ns, ['plugin', 'activate', 'woocommerce']);
    return;
  } catch {
    log.info('wpcli.plugin.activate', 'WooCommerce not pre-installed, attempting download', { storeId });
  }

  // Fallback: download from wordpress.org
  try {
    await wpCli(storeId, ns, ['plugin', 'install', 'woocommerce', '--activate']);
    return;
  } catch {
    log.info('wpcli.plugin.install', 'Slug-based install failed, trying direct URL', { storeId });
  }

  // Last resort: direct download URL
  await wpCli(storeId, ns, [
    'plugin', 'install',
    'https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip',
    '--activate',
  ]);
}

async function configurePermalinks(storeId: string, ns: string): Promise<void> {
  await wpCli(storeId, ns, ['rewrite', 'structure', '/%postname%/']);
  await wpCli(storeId, ns, ['rewrite', 'flush']);
  log.info('wpcli.permalinks.done', 'Permalinks configured', { storeId });
}

async function installRestAuthPlugin(storeId: string, ns: string): Promise<void> {
  const php = [
    '$dir = ABSPATH . "wp-content/mu-plugins";',
    'if (!is_dir($dir)) mkdir($dir, 0755, true);',
    'file_put_contents($dir . "/wc-rest-auth-http.php",',
    '"<?php\\n" .',
    '"add_action(\'plugins_loaded\', function() {\\n" .',
    '"  if (strpos(\\$_SERVER[\'REQUEST_URI\'] ?? \'\', \'/wp-json/\') !== false) {\\n" .',
    '"    \\$_SERVER[\'HTTPS\'] = \'on\';\\n" .',
    '"  }\\n" .',
    '"}, 1);\\n"',
    ');',
  ].join(' ');
  await podExec(storeId, ns, ['wp', 'eval', php, '--allow-root']);
  log.info('wpcli.muplugin.done', 'REST auth mu-plugin installed', { storeId });
}

async function seedProducts(storeId: string, ns: string, template: StoreTemplate): Promise<void> {
  const products = TEMPLATE_PRODUCTS[template] || TEMPLATE_PRODUCTS.general;
  const count = (await wpCli(storeId, ns, ['wc', 'product', 'list', '--format=count', '--user=user'])).trim();
  if (count !== '0') {
    log.info('wpcli.product.skip', 'Products already exist', { storeId });
    return;
  }

  for (const p of products) {
    await wpCli(storeId, ns, [
      'wc', 'product', 'create',
      `--name=${p.name}`, '--type=simple', `--regular_price=${p.price}`,
      '--status=publish', '--user=user',
    ]);
  }
  log.info('wpcli.product.done', `${products.length} products created`, { storeId });
}

async function configureWooCommerce(storeId: string, ns: string): Promise<void> {
  await wpCli(storeId, ns, ['option', 'update', 'woocommerce_feature_custom_order_tables_enabled', 'yes']);
  await wpCli(storeId, ns, ['option', 'update', 'woocommerce_custom_orders_table_enabled', 'yes']);
  await wpCli(storeId, ns, [
    'option', 'update', 'woocommerce_cod_settings',
    '{"enabled":"yes","title":"Cash on Delivery"}', '--format=json',
  ]);
  await wpCli(storeId, ns, ['option', 'update', 'woocommerce_coming_soon', 'no']);
  await wpCli(storeId, ns, ['option', 'update', 'woocommerce_store_pages_only', 'no']);
  log.info('wpcli.config.done', 'HPOS + COD enabled, coming soon disabled', { storeId });
}

async function configureStoreAdmin(storeId: string, ns: string): Promise<void> {
  const php = [
    'update_option("woocommerce_onboarding_profile", array("completed" => true));',
    'update_option("woocommerce_task_list_complete", "yes");',
    'update_option("woocommerce_task_list_hidden", "yes");',
    'update_option("woocommerce_store_address", "Arrakeen Market District");',
    'update_option("woocommerce_default_country", "US:CA");',
    'update_option("woocommerce_currency", "USD");',
  ].join(' ');
  await podExec(storeId, ns, ['wp', 'eval', php, '--allow-root']);
  try {
    await wpCli(storeId, ns, ['post', 'delete', '1', '--force']);
  } catch {
    // Hello World post may not exist
  }
  log.info('wpcli.admin.done', 'Store admin configured', { storeId });
}

async function setShopHomepage(storeId: string, ns: string): Promise<void> {
  await wpCli(storeId, ns, ['option', 'update', 'show_on_front', 'page']);
  const shopId = (await wpCli(storeId, ns, ['post', 'list', '--post_type=page', '--name=shop', '--field=ID'])).trim();
  if (shopId) await wpCli(storeId, ns, ['option', 'update', 'page_on_front', shopId]);
  log.info('wpcli.homepage.done', 'Shop set as homepage', { storeId });
}

async function cleanupDefaultPages(storeId: string, ns: string): Promise<void> {
  try {
    const pageId = (await wpCli(storeId, ns, ['post', 'list', '--post_type=page', '--name=sample-page', '--field=ID'])).trim();
    if (pageId) await wpCli(storeId, ns, ['post', 'delete', pageId, '--force']);
  } catch {
    log.warn('wpcli.cleanup.skip', 'Could not remove sample page', { storeId });
  }
}

async function generateWcApiKeys(storeId: string, ns: string): Promise<void> {
  try {
    const php = [
      'global $wpdb;',
      '$key = bin2hex(random_bytes(20));',
      '$secret = bin2hex(random_bytes(20));',
      '$wpdb->insert($wpdb->prefix . "woocommerce_api_keys", array(',
      '  "user_id" => 1, "description" => "arrakis", "permissions" => "read_write",',
      '  "consumer_key" => wc_api_hash("ck_" . $key),',
      '  "consumer_secret" => "cs_" . $secret,',
      '  "truncated_key" => substr($key, -7)',
      '));',
      'echo json_encode(array("ck" => "ck_" . $key, "cs" => "cs_" . $secret));',
    ].join(' ');

    const keys = JSON.parse((await podExec(storeId, ns, ['wp', 'eval', php, '--allow-root'])).trim());
    await createSecret(ns, `${storeId}-wc-api`, { consumer_key: keys.ck, consumer_secret: keys.cs });
    log.info('wpcli.apikey.done', 'WC API keys stored', { storeId });
  } catch (err: any) {
    log.error('wpcli.apikey.fail', `WC API key generation failed: ${err.message}`, { storeId });
    throw new Error(`WC API key generation failed: ${err.message}`);
  }
}
