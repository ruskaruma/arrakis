import * as assert from 'assert';
import { execFile, ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';

const execFileAsync = promisify(execFile);

const API_BASE = process.env.API_URL || 'http://localhost:8080';
const READY_TIMEOUT_MS = 5 * 60 * 1000;
const DELETE_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

// Helpers

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function httpRequest(url: string, options: http.RequestOptions = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if ((options as any)._body) req.write((options as any)._body);
    req.end();
  });
}

async function apiPost(path: string, data: object): Promise<{ status: number; json: any }> {
  const body = JSON.stringify(data);
  const url = new URL(path, API_BASE);
  const res = await httpRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    _body: body,
  } as any);
  return { status: res.status, json: JSON.parse(res.body) };
}

async function apiGet(path: string): Promise<{ status: number; json: any }> {
  const url = new URL(path, API_BASE);
  const res = await httpRequest(url.toString(), { method: 'GET' });
  return { status: res.status, json: JSON.parse(res.body) };
}

async function apiDelete(path: string): Promise<number> {
  const url = new URL(path, API_BASE);
  const res = await httpRequest(url.toString(), { method: 'DELETE' });
  return res.status;
}

async function namespaceExists(ns: string): Promise<boolean> {
  try {
    await execFileAsync('kubectl', ['get', 'namespace', ns], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForPhase(storeId: string, targetPhase: string, timeoutMs: number): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { json } = await apiGet(`/api/stores/${storeId}`);
    const phase = json.phase;
    console.log(`  [poll] ${storeId} phase=${phase} message="${json.message || ''}" (${Math.round((Date.now() - start) / 1000)}s)`);

    if (phase === targetPhase) return json;
    if (phase === 'Failed') throw new Error(`Store ${storeId} entered Failed: ${json.message}`);

    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timeout waiting for ${storeId} to reach ${targetPhase} (${timeoutMs / 1000}s)`);
}

async function waitForNamespaceGone(ns: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await namespaceExists(ns))) return;
    console.log(`  [poll] namespace ${ns} still exists (${Math.round((Date.now() - start) / 1000)}s)`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timeout waiting for namespace ${ns} to be deleted (${timeoutMs / 1000}s)`);
}

// Test runner

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n== TEST: ${name} ==`);
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(name);
    console.error(`FAIL: ${name}`);
    console.error(`  ${err.message}`);
  }
}

// Tests

async function testCreateStoreReachesReady(): Promise<string> {
  let storeId = '';

  await test('Create store via API reaches Ready', async () => {
    //Create
    const { status, json } = await apiPost('/api/stores', { engine: 'woocommerce' });
    assert.strictEqual(status, 201, `Expected 201, got ${status}`);
    assert.ok(json.id, 'Response must include store id');
    storeId = json.id;
    console.log(`  Store created: ${storeId}`);

    //Poll until Ready
    const ready = await waitForPhase(storeId, 'Ready', READY_TIMEOUT_MS);
    assert.strictEqual(ready.phase, 'Ready');
    assert.ok(ready.url, 'Ready store must have a URL');
    console.log(`  Store ready at: ${ready.url}`);
  });

  return storeId;
}

async function testStoreUrlReturns200(storeId: string): Promise<void> {
  await test('Store URL returns 200', async () => {
    assert.ok(storeId, 'Need a store ID from previous test');

    const { json } = await apiGet(`/api/stores/${storeId}`);
    const storeUrl = json.url;
    assert.ok(storeUrl, 'Store must have a URL');

    //HTTP GET against the store's ingress
    //Use kubectl port-forward or curl through cluster since nip.io may not resolve locally
    const { stdout } = await execFileAsync('kubectl', [
      'exec', `deploy/${storeId}-wordpress`,
      '-n', `store-${storeId}`,
      '--',
      'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8080/',
    ], { timeout: 30_000 });

    const httpCode = stdout.trim();
    assert.strictEqual(httpCode, '200', `Expected HTTP 200, got ${httpCode}`);
    console.log(`  HTTP check: ${httpCode}`);
  });
}

async function testDeleteStoreNamespaceGone(storeId: string): Promise<void> {
  await test('Delete store removes namespace', async () => {
    assert.ok(storeId, 'Need a store ID from previous test');
    const ns = `store-${storeId}`;

    //Verify namespace exists before delete
    assert.ok(await namespaceExists(ns), `Namespace ${ns} should exist before delete`);

    //Delete
    const status = await apiDelete(`/api/stores/${storeId}`);
    assert.strictEqual(status, 204, `Expected 204, got ${status}`);
    console.log(`  Delete request sent for ${storeId}`);

    //Wait for namespace to be cleaned up
    await waitForNamespaceGone(ns, DELETE_TIMEOUT_MS);
    console.log(`  Namespace ${ns} is gone`);

    //Verify store CRD is also gone
    const { status: getStatus } = await apiGet(`/api/stores/${storeId}`);
    assert.strictEqual(getStatus, 404, `Expected 404 after delete, got ${getStatus}`);
  });
}

async function testOperatorRecovery(): Promise<void> {
  await test('Operator recovery after restart', async () => {
    //Create a new store
    const { status, json } = await apiPost('/api/stores', { engine: 'woocommerce' });
    assert.strictEqual(status, 201);
    const storeId = json.id;
    console.log(`  Created store: ${storeId}`);

    //Wait until it's at least Provisioning (not just Pending)
    const start = Date.now();
    let phase = '';
    while (Date.now() - start < 60_000) {
      const { json: s } = await apiGet(`/api/stores/${storeId}`);
      phase = s.phase;
      if (phase !== 'Pending') break;
      await sleep(2_000);
    }
    console.log(`  Store phase before kill: ${phase}`);

    //Kill the operator
    console.log('  Killing operator...');
    try {
      await execFileAsync('pkill', ['-f', 'ts-node.*operator.*index'], { timeout: 5_000 });
    } catch {
      //pkill returns non-zero if no process matched, try node version
      try {
        await execFileAsync('pkill', ['-f', 'node.*operator.*index'], { timeout: 5_000 });
      } catch {}
    }
    await sleep(2_000);

    //Restart the operator in background
    console.log('  Restarting operator...');
    const operatorDir = require('path').resolve(__dirname, '../../operator');
    const operatorProc: ChildProcess = spawn('npx', ['ts-node', 'src/index.ts'], {
      cwd: operatorDir,
      stdio: 'ignore',
      detached: true,
    });
    operatorProc.unref();

    //Wait a bit for operator to initialize
    await sleep(5_000);

    //The store should eventually reach Ready (operator should pick it up via periodic sync)
    const ready = await waitForPhase(storeId, 'Ready', READY_TIMEOUT_MS);
    assert.strictEqual(ready.phase, 'Ready');
    console.log(`  Store recovered to Ready after operator restart`);

    //Cleanup
    await apiDelete(`/api/stores/${storeId}`);
    await waitForNamespaceGone(`store-${storeId}`, DELETE_TIMEOUT_MS);
    console.log(`  Cleanup done`);
  });
}

// Main

async function main(): Promise<void> {
  console.log('Arrakis Integration Tests');
  console.log(`API: ${API_BASE}`);
  console.log(`Ready timeout: ${READY_TIMEOUT_MS / 1000}s`);
  console.log('');

  //Preflight: check API is reachable
  try {
    const { status } = await httpRequest(`${API_BASE}/health`);
    assert.strictEqual(status, 200, 'API health check failed');
    console.log('API health check: OK');
  } catch (err: any) {
    console.error(`FATAL: Cannot reach API at ${API_BASE} — ${err.message}`);
    console.error('Make sure the API server is running: cd api && npx ts-node src/server.ts');
    process.exit(1);
  }

  //Test 1 + 2 + 3: create → verify URL → delete (sequential, same store)
  const storeId = await testCreateStoreReachesReady();
  if (storeId) {
    await testStoreUrlReturns200(storeId);
    await testDeleteStoreNamespaceGone(storeId);
  }

  //Test 4: operator recovery
  await testOperatorRecovery();

  //Summary
  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(', ')}`);
  }
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

main();
