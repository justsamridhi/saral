const http = require('http');
const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_MODE = 'true';

const app = require('./server');

let server;
let baseUrl;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    if (body && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runSecurityTests() {
  console.log('================================================================');
  console.log(' SARAL — Hardened Security & PayPal Lifecycle Verification');
  console.log('================================================================\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• ${name}... `);
      await fn();
      console.log('PASSED ✓');
      passed++;
    } catch (err) {
      console.log('FAILED ✗');
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    await test('GET /api/health returns 200 with services status', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.ok(res.body.services);
    });

    // 2. Static serving restrictions
    await test('Static Protection: Blocks .env, server.js, package.json, schema.sql', async () => {
      const resEnv = await request('GET', '/.env');
      assert.ok([403, 404].includes(resEnv.status), `Expected 403 or 404 for .env, got ${resEnv.status}`);

      const resServer = await request('GET', '/server.js');
      assert.ok([403, 404].includes(resServer.status), `Expected 403 or 404 for server.js, got ${resServer.status}`);

      const resPkg = await request('GET', '/package.json');
      assert.ok([403, 404].includes(resPkg.status), `Expected 403 or 404 for package.json, got ${resPkg.status}`);

      const resSql = await request('GET', '/schema.sql');
      assert.ok([403, 404].includes(resSql.status), `Expected 403 or 404 for schema.sql, got ${resSql.status}`);
    });

    await test('Static Protection: Allows frontend files (saral.html, supabase-config.js)', async () => {
      const resRoot = await request('GET', '/');
      assert.strictEqual(resRoot.status, 200);

      const resConfig = await request('GET', '/supabase-config.js');
      assert.strictEqual(resConfig.status, 200);
    });

    // 3. Demo vs Real Auth paths
    await test('Auth: Demo token gives demo user context with isDemo=true', async () => {
      const res = await request('GET', '/api/profile', null, { 'Authorization': 'Bearer demo-token' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.is_demo, true);
    });

    await test('Auth: Missing token gives 401 Unauthorized', async () => {
      const res = await request('GET', '/api/profile');
      assert.strictEqual(res.status, 401);
    });

    // 4. Order creation validation
    await test('POST /api/paypal/orders: Missing proposalId returns 400', async () => {
      const res = await request('POST', '/api/paypal/orders', { intent: 'AUTHORIZE' }, { 'Authorization': 'Bearer test-user-:u-real-99:real@saral.id' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Missing proposalId in request body');
    });

    await test('POST /api/paypal/orders: Invalid intent returns 400', async () => {
      const res = await request('POST', '/api/paypal/orders', { proposalId: 'prop-123', intent: 'INVALID_INTENT' }, { 'Authorization': 'Bearer test-user-:u-real-99:real@saral.id' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Invalid intent: must be AUTHORIZE or CAPTURE');
    });

    await test('POST /api/paypal/orders: Non-existent proposal returns 404', async () => {
      const res = await request('POST', '/api/paypal/orders', { proposalId: 'non-existent-prop-999', intent: 'AUTHORIZE' }, { 'Authorization': 'Bearer test-user-:u-real-99:real@saral.id' });
      assert.strictEqual(res.status, 404);
    });

    // 5. Capture security
    await test('POST /api/payments/:id/capture: Non-existent payment returns 404', async () => {
      const res = await request('POST', '/api/payments/pay-ghost-999/capture', {}, { 'Authorization': 'Bearer test-user-:u-real-99:real@saral.id' });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Payment not found or access denied.');
    });

    // 6. Void security
    await test('POST /api/payments/:id/void: Non-existent payment returns 404', async () => {
      const res = await request('POST', '/api/payments/pay-ghost-999/void', {}, { 'Authorization': 'Bearer test-user-:u-real-99:real@saral.id' });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Payment not found or access denied.');
    });

    // 7. Reconcile security & cross-user isolation
    await test('GET /api/payments/:id/reconcile: Non-existent payment returns 404', async () => {
      const res = await request('GET', '/api/payments/pay-ghost-999/reconcile', null, { 'Authorization': 'Bearer test-user-:u-real-99:real@saral.id' });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Payment not found or access denied.');
    });

    // 8. Agent session ownership
    await test('GET /api/agent/sessions/:id: Non-owned session returns 403', async () => {
      // First create a session under user A
      await request('POST', '/api/agent/message', { session_id: 'sess-owner-test', message: 'Hello SARAL' }, { 'Authorization': 'Bearer test-user-:userA:a@saral.test' });

      // Try reading as user B
      const res = await request('GET', '/api/agent/sessions/sess-owner-test', null, { 'Authorization': 'Bearer test-user-:userB:b@saral.test' });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Unauthorized: You do not own this agent session');
    });

    // 9. Webhook verification
    await test('POST /api/paypal/webhook: Missing event id returns 400', async () => {
      const res = await request('POST', '/api/paypal/webhook', {});
      assert.strictEqual(res.status, 400);
    });

    await test('POST /api/paypal/webhook: Missing transmission headers returns 400', async () => {
      const res = await request('POST', '/api/paypal/webhook', { id: 'WH-123', event_type: 'PAYMENT.CAPTURE.COMPLETED' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Missing required PayPal transmission headers');
    });

    await test('POST /api/paypal/webhook: Rejects forged webhook transmission headers', async () => {
      const res = await request('POST', '/api/paypal/webhook', { id: 'WH-FORGED-123', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123',
        'paypal-transmission-id': 'trans-123',
        'paypal-transmission-sig': 'bad-signature',
        'paypal-transmission-time': '2026-11-03T12:00:00Z'
      });
      // Should reject with 400 (signature verification failed or rejected)
      assert.ok([400, 502, 503].includes(res.status), `Expected rejection status, got ${res.status}`);
    });

  } finally {
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(` Security Verification Results: ${passed} Passed, ${failed} Failed`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch(err => {
  console.error('Fatal Security Test Error:', err);
  if (server) server.close();
  process.exit(1);
});

