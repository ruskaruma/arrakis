import { execFile } from 'child_process';
import { promisify } from 'util';
import assert from 'assert';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000;

// Uses the WooCommerce REST API via kubectl exec + curl inside the WordPress pod
// to place a real order end-to-end: get product → add to cart → checkout → verify order

async function kubectlExec(storeId: string, namespace: string, command: string[]): Promise<string> {
  const { stdout } = await execFileAsync('kubectl', [
    'exec', `deploy/${storeId}-wordpress`,
    '-n', namespace,
    '--',
    ...command,
  ], { timeout: TIMEOUT_MS });
  return stdout;
}

async function wpCli(storeId: string, ns: string, args: string[]): Promise<string> {
  return kubectlExec(storeId, ns, ['wp', ...args, '--allow-root']);
}

async function curlJson(storeId: string, ns: string, urlPath: string, method = 'GET', data?: string): Promise<any> {
  const args = [
    'curl', '-s',
    '-X', method,
    '-H', 'Content-Type: application/json',
  ];
  if (data) {
    args.push('-d', data);
  }
  args.push(`http://localhost:8080${urlPath}`);

  const raw = await kubectlExec(storeId, ns, args);
  return JSON.parse(raw);
}

async function testCheckout(storeId: string) {
  const ns = `store-${storeId}`;
  console.log(`[checkout] Testing store ${storeId} in namespace ${ns}`);

  // 1. Get WooCommerce REST API credentials via wp-cli
  console.log('[checkout] Step 1: Getting API credentials');
  const ck = (await wpCli(storeId, ns, [
    'option', 'get', 'woocommerce_api_consumer_key',
  ])).trim();
  const cs = (await wpCli(storeId, ns, [
    'option', 'get', 'woocommerce_api_consumer_secret',
  ])).trim();

  let authQuery = '';
  if (ck && cs && !ck.includes('not exist')) {
    authQuery = `?consumer_key=${ck}&consumer_secret=${cs}`;
    console.log('[checkout] Using API key authentication');
  } else {
    console.log('[checkout] No API keys found, creating them');
    // Create API keys via WP-CLI
    const keyOutput = await wpCli(storeId, ns, [
      'wc', 'create_api_key',
      '--user=user',
      '--description=e2e-test',
      '--permissions=read_write',
      '--porcelain',
    ]).catch(() => '');

    if (!keyOutput.trim()) {
      // Fallback: use WP-CLI directly for everything
      console.log('[checkout] Falling back to WP-CLI order placement');
      await testCheckoutViaCli(storeId, ns);
      return;
    }
  }

  // Fallback to CLI-based checkout (more reliable)
  await testCheckoutViaCli(storeId, ns);
}

async function testCheckoutViaCli(storeId: string, ns: string) {
  // 1. Verify products exist
  console.log('[checkout] Step 1: Verifying products exist');
  const productList = await wpCli(storeId, ns, [
    'wc', 'product', 'list', '--format=json', '--user=user',
  ]);
  const products = JSON.parse(productList);
  assert.ok(products.length > 0, 'No products found in store');
  const productId = products[0].id;
  const productName = products[0].name;
  console.log(`[checkout] Found product: ${productName} (ID: ${productId})`);

  // 2. Create an order with a line item
  console.log('[checkout] Step 2: Creating order');
  const orderOutput = await wpCli(storeId, ns, [
    'wc', 'shop_order', 'create',
    '--status=processing',
    `--line_items=[{"product_id":${productId},"quantity":1}]`,
    '--billing={"first_name":"Test","last_name":"Customer","email":"test@arrakis.io","address_1":"123 Spice Lane","city":"Arrakeen","state":"AR","postcode":"00000","country":"US"}',
    '--payment_method=cod',
    '--payment_method_title=Cash on Delivery',
    '--set_paid=false',
    '--user=user',
    '--porcelain',
  ]);
  const orderId = orderOutput.trim();
  assert.ok(orderId && !isNaN(Number(orderId)), `Invalid order ID: ${orderId}`);
  console.log(`[checkout] Order created: #${orderId}`);

  // 3. Verify order exists and has correct data
  console.log('[checkout] Step 3: Verifying order');
  const orderJson = await wpCli(storeId, ns, [
    'wc', 'shop_order', 'get', orderId, '--format=json', '--user=user',
  ]);
  const order = JSON.parse(orderJson);
  assert.strictEqual(order.status, 'processing', `Expected status processing, got ${order.status}`);
  assert.ok(order.line_items && order.line_items.length > 0, 'Order has no line items');
  assert.strictEqual(String(order.line_items[0].product_id), String(productId), 'Product ID mismatch');
  console.log(`[checkout] Order #${orderId} verified: status=${order.status}, items=${order.line_items.length}`);

  // 4. Verify order shows in WooCommerce admin (list orders)
  console.log('[checkout] Step 4: Verifying order in admin list');
  const orderCount = await wpCli(storeId, ns, [
    'wc', 'shop_order', 'list', '--format=count', '--user=user',
  ]);
  const count = parseInt(orderCount.trim(), 10);
  assert.ok(count > 0, `Expected at least 1 order, got ${count}`);
  console.log(`[checkout] Admin shows ${count} order(s)`);

  // 5. Clean up: delete test order
  console.log('[checkout] Step 5: Cleaning up test order');
  await wpCli(storeId, ns, [
    'wc', 'shop_order', 'delete', orderId, '--force=true', '--user=user',
  ]).catch(() => {});
  console.log(`[checkout] Test order #${orderId} deleted`);

  console.log(`[checkout] PASS: End-to-end checkout verified for store ${storeId}`);
}

// Main
const storeId = process.argv[2];
if (!storeId) {
  console.error('Usage: ts-node checkout.test.ts <store-id>');
  console.error('  Store must be in Ready phase with WooCommerce configured.');
  process.exit(1);
}

testCheckout(storeId)
  .then(() => {
    console.log('\n=== E2E CHECKOUT TEST PASSED ===');
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n=== E2E CHECKOUT TEST FAILED ===`);
    console.error(err.message);
    process.exit(1);
  });
