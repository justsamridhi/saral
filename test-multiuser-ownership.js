/**
 * SARAL — Multi-User Data Isolation & Ownership Test Suite
 * Priority 4 Verification:
 * Demonstrates that User A (Alice) and User B (Bob) have complete isolation:
 * 1. Alice creates proposals, payments/holds, quotes, and agent sessions.
 * 2. Bob cannot see Alice's active holds or recent payments (Bob gets an empty list).
 * 3. Bob cannot access, approve, or reject Alice's proposals (returns 403 Forbidden).
 * 4. Bob cannot capture, void, or refund Alice's payment authorizations (returns 404 / Access Denied).
 * 5. Bob cannot access or inject messages into Alice's agent chat session (returns 403 Forbidden).
 */

const http = require('http');
const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_MODE = 'false';

const app = require('./server');

let server;
let port;
let baseUrl;

const ALICE_TOKEN = 'Bearer test-user-:usr-alice-1111:alice@saral.test';
const BOB_TOKEN = 'Bearer test-user-:usr-bob-2222:bob@saral.test';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = token;
    }

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
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runMultiUserTests() {
  console.log('================================================================');
  console.log(' SARAL — Multi-User Ownership & Data Isolation Test Suite');
  console.log(' Users: Alice (usr-alice-1111) vs Bob (usr-bob-2222)');
  console.log('================================================================\n');

  // Start server on an ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[INFO] Test server started at ${baseUrl}\n`);
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

  let aliceProposalId;
  let alicePaymentId;
  let aliceSessionId;

  try {
    // Step 1: Alice creates a proposal
    await test('Alice: Successfully creates a Cinema proposal', async () => {
      const res = await request('POST', '/api/proposals', {
        service_type: 'cinema',
        title: 'IMAX Cinema Seats D3, D4',
        merchant: 'Grand Cineplex IMAX',
        amount_minor: 3800,
        items: [{ name: 'IMAX Tickets', qty: 2, price_minor: 3800 }]
      }, ALICE_TOKEN);

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.ok(res.body.proposal, 'Proposal object should be returned');
      assert.strictEqual(res.body.proposal.user_id, 'usr-alice-1111');
      aliceProposalId = res.body.proposal.id;
    });

    // Step 2: Bob tries to access Alice's proposal
    await test('Bob: Cannot view Alice’s proposal (Blocked with 403 Forbidden)', async () => {
      const res = await request('GET', `/api/proposals/${aliceProposalId}`, null, BOB_TOKEN);
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.error, 'Unauthorized: You do not own this proposal');
    });

    // Step 3: Bob tries to approve Alice's proposal
    await test('Bob: Cannot approve Alice’s proposal (Blocked with 403 Forbidden)', async () => {
      const res = await request('POST', `/api/proposals/${aliceProposalId}/approve`, {}, BOB_TOKEN);
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.error, 'Unauthorized: You do not own this proposal');
    });

    // Step 4: Bob tries to reject Alice's proposal
    await test('Bob: Cannot reject Alice’s proposal (Blocked with 403 Forbidden)', async () => {
      const res = await request('POST', `/api/proposals/${aliceProposalId}/reject`, {}, BOB_TOKEN);
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.error, 'Unauthorized: You do not own this proposal');
    });

    // Step 5: Alice approves her own proposal
    await test('Alice: Can approve her own proposal', async () => {
      const res = await request('POST', `/api/proposals/${aliceProposalId}/approve`, {}, ALICE_TOKEN);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'approved');
    });

    // Step 6: Alice creates a PayPal order / hold
    await test('Alice: Creates a PayPal authorization hold', async () => {
      const orderRes = await request('POST', '/api/paypal/orders', {
        proposalId: aliceProposalId,
        intent: 'AUTHORIZE'
      }, ALICE_TOKEN);

      assert.strictEqual(orderRes.status, 200);
      const orderId = orderRes.body.id;

      const authRes = await request('POST', `/api/paypal/orders/${orderId}/authorize`, {}, ALICE_TOKEN);
      assert.strictEqual(authRes.status, 200);
      alicePaymentId = orderId;
    });

    // Step 7: Bob queries active holds — Bob must see zero holds
    await test('Bob: Sees only his own active holds (Empty array, 0 holds)', async () => {
      const res = await request('GET', '/api/payments/active-holds', null, BOB_TOKEN);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body), 'Response must be an array');
      assert.strictEqual(res.body.length, 0, 'Bob must not see Alice’s active hold');
    });

    // Step 8: Alice queries active holds — Alice sees her hold
    await test('Alice: Sees her own active hold in ledger', async () => {
      const res = await request('GET', '/api/payments/active-holds', null, ALICE_TOKEN);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.strictEqual(res.body.length, 1);
      assert.strictEqual(res.body[0].order_id, alicePaymentId);
    });

    // Step 9: Bob tries to capture Alice's payment hold
    await test('Bob: Cannot capture Alice’s payment hold (Blocked with 404 Access Denied)', async () => {
      const res = await request('POST', `/api/payments/${alicePaymentId}/capture`, { amount: '38.00' }, BOB_TOKEN);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Payment not found or access denied.');
    });

    // Step 10: Bob tries to void Alice's payment hold
    await test('Bob: Cannot void Alice’s payment hold (Blocked with 404 Access Denied)', async () => {
      const res = await request('POST', `/api/payments/${alicePaymentId}/void`, {}, BOB_TOKEN);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Payment not found or access denied.');
    });

    // Step 11: Alice captures her own payment hold
    await test('Alice: Captures her own payment hold successfully', async () => {
      const res = await request('POST', `/api/payments/${alicePaymentId}/capture`, { amount: '38.00' }, ALICE_TOKEN);
      assert.strictEqual(res.status, 200);
    });

    // Step 12: Bob tries to refund Alice's captured payment
    await test('Bob: Cannot refund Alice’s payment (Blocked with 404 Access Denied)', async () => {
      const res = await request('POST', `/api/payments/${alicePaymentId}/refund`, { amount: '38.00' }, BOB_TOKEN);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Payment not found or access denied.');
    });

    // Step 13: Alice starts an Ask SARAL agent chat session
    await test('Alice: Starts an Ask SARAL agent session', async () => {
      aliceSessionId = `sess-alice-${Date.now()}`;
      const res = await request('POST', '/api/agent/message', {
        session_id: aliceSessionId,
        message: 'Find me tickets for Dune 2 at IMAX tonight'
      }, ALICE_TOKEN);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message, 'Agent response should be returned');
      assert.ok(res.body.proposal, 'Structured proposal should be produced');
    });

    // Step 14: Bob tries to read Alice's agent chat session
    await test('Bob: Cannot read Alice’s chat session messages (Blocked with 403 Forbidden)', async () => {
      const res = await request('GET', `/api/agent/sessions/${aliceSessionId}`, null, BOB_TOKEN);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Unauthorized: You do not own this agent session');
    });

    // Step 15: Bob tries to inject a message into Alice's session
    await test('Bob: Cannot send messages into Alice’s session (Blocked with 403 Forbidden)', async () => {
      const res = await request('POST', '/api/agent/message', {
        session_id: aliceSessionId,
        message: 'Malicious injection from Bob'
      }, BOB_TOKEN);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Unauthorized: You do not own this agent session');
    });

    // Step 16: Alice refunds her own payment (Full refund)
    await test('Alice: Initiates a full refund on her own payment', async () => {
      const res = await request('POST', `/api/payments/${alicePaymentId}/refund`, { amount: '38.00' }, ALICE_TOKEN);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'COMPLETED');
      assert.strictEqual(res.body.amount, '38.00');
    });

  } finally {
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(` Multi-User Ownership Results: ${passed} Passed, ${failed} Failed`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMultiUserTests().catch(err => {
  console.error('Fatal Test Error:', err);
  if (server) server.close();
  process.exit(1);
});
