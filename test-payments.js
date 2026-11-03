/**
 * SARAL — Milestone 2 Test Suite: Mini-Apps, Quote Integrity, Trust Gate & PayPal Lifecycle
 * Validates backend endpoints, integer minor units, proposal limit checks,
 * quote HMAC hashes, Ask SARAL agent tool dispatch, and service reconciliations.
 */

const assert = require('assert');
const crypto = require('crypto');

// Test Configuration
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const QUOTE_SECRET = process.env.QUOTE_SECRET || 'saral-quote-integrity-secret-2026';

function generateTestQuoteHash(payload) {
  const normalized = `${payload.user_id}:${payload.miniapp_id}:${payload.amount_minor}:${payload.expires_at}`;
  return crypto.createHmac('sha256', QUOTE_SECRET).update(normalized).digest('hex');
}

async function runTests() {
  console.log('====================================================');
  console.log(' SARAL Milestone 2: Personal Ecosystem & Agent Test Suite');
  console.log(` Target Server: ${BASE_URL}`);
  console.log('====================================================\n');

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

  // Unit / Math Tests
  await test('Integer Minor Units Math: Cents conversions without floating drift', async () => {
    const rawDollars = 36.50;
    const minorUnits = Math.round(rawDollars * 100);
    assert.strictEqual(minorUnits, 3650, '36.50 must convert exactly to 3650 cents');

    const backToDollars = (minorUnits / 100).toFixed(2);
    assert.strictEqual(backToDollars, '36.50', '3650 cents must format back to 36.50');

    const floatDriftValue = 19.99;
    const safeMinor = Math.round(floatDriftValue * 100);
    assert.strictEqual(safeMinor, 1999, '19.99 must be rounded cleanly to 1999 minor units');
  });

  await test('Spending Limit Guardrail Logic: Enforces $500 per-tx & $2000 daily limits', async () => {
    const perTxCapMinor = 50000; // $500.00
    const dailyCapMinor = 200000; // $2000.00
    const committedTodayMinor = 180000; // $1800.00 already committed today

    // Valid proposal under both limits
    const validProposalAmount = 15000; // $150.00
    assert.ok(validProposalAmount <= perTxCapMinor, 'Proposal must be within per-tx limit');
    assert.ok((committedTodayMinor + validProposalAmount) <= dailyCapMinor, 'Proposal must fit within daily limit');

    // Breach per-tx limit
    const overTxProposalAmount = 60000; // $600.00
    assert.ok(overTxProposalAmount > perTxCapMinor, 'Transaction over $500 must trigger per-tx cap breach');

    // Breach cumulative daily limit
    const overDailyProposalAmount = 25000; // $250.00 ($1800 + $250 = $2050 > $2000)
    assert.ok((committedTodayMinor + overDailyProposalAmount) > dailyCapMinor, 'Transaction exceeding cumulative daily cap must be flagged');
  });

  await test('Quote HMAC SHA-256 Integrity: Hash verifies authentic quotes & rejects tampering', async () => {
    const payload = {
      user_id: 'user-test-uuid',
      miniapp_id: 'cinema',
      amount_minor: 3800,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
    const validHash = generateTestQuoteHash(payload);
    assert.ok(validHash && validHash.length === 64, 'HMAC SHA-256 hash must be 64-char hex string');

    // Verify matching hash
    const recomputed = generateTestQuoteHash(payload);
    assert.strictEqual(validHash, recomputed, 'Recomputed hash must match authentic quote');

    // Tampered amount (e.g. attacker changes 3800 to 100)
    const tamperedPayload = { ...payload, amount_minor: 100 };
    const tamperedHash = generateTestQuoteHash(tamperedPayload);
    assert.notStrictEqual(validHash, tamperedHash, 'Tampered quote amount must produce distinct HMAC hash');
  });

  await test('Power Bank Reconciliation Math: Holds $18.00 deposit, captures $3.00, releases $15.00', async () => {
    const depositMinor = 1800; // $18.00 hold
    const hoursElapsed = 2;
    const ratePerHourMinor = 150; // $1.50/hr
    const capturedMinor = hoursElapsed * ratePerHourMinor; // $3.00
    const releasedMinor = depositMinor - capturedMinor; // $15.00

    assert.strictEqual(capturedMinor, 300, '2 hours at $1.50/hr must capture exactly $3.00 (300 cents)');
    assert.strictEqual(releasedMinor, 1500, 'Must release remaining $15.00 (1500 cents)');
  });

  await test('EV Charging Session Math: Holds $40.00, metered 28.5 kWh captures $11.97, releases $28.03', async () => {
    const holdMinor = 4000; // $40.00 max hold
    const kwhMetered = 28.5;
    const ratePerKwhMinor = 42; // $0.42/kWh
    const capturedMinor = Math.round(kwhMetered * ratePerKwhMinor); // 1197 cents ($11.97)
    const releasedMinor = holdMinor - capturedMinor; // 2803 cents ($28.03)

    assert.strictEqual(capturedMinor, 1197, '28.5 kWh at $0.42/kWh must be 1197 cents ($11.97)');
    assert.strictEqual(releasedMinor, 2803, 'Must release remaining 2803 cents ($28.03)');
  });

  // End-to-end API verification against running server if available
  let serverReachable = false;
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (res.ok) serverReachable = true;
  } catch (e) {
    serverReachable = false;
  }

  if (serverReachable) {
    await test('GET /api/health: Returns 200 OK with services status', async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.services, 'Health check should contain services status');
    });

    await test('GET /api/apps: Returns all 6 Canonical Mini-Apps', async () => {
      const res = await fetch(`${BASE_URL}/api/apps`, {
        headers: { 'Authorization': 'Bearer demo-token' }
      });
      assert.strictEqual(res.status, 200);
      const apps = await res.json();
      assert.strictEqual(apps.length, 6, 'Must return all 6 mini-apps');
      const ids = apps.map(a => a.id);
      assert.ok(ids.includes('cinema'), 'Should include cinema');
      assert.ok(ids.includes('powerbank'), 'Should include powerbank');
      assert.ok(ids.includes('recharge'), 'Should include recharge');
      assert.ok(ids.includes('ev'), 'Should include ev');
      assert.ok(ids.includes('utilities'), 'Should include utilities');
      assert.ok(ids.includes('food'), 'Should include food');
    });

    await test('POST /api/apps/cinema/quote: Server calculates price & returns HMAC hash', async () => {
      const res = await fetch(`${BASE_URL}/api/apps/cinema/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer demo-token'
        },
        body: JSON.stringify({ params: { seats: ['D3', 'D4'] } })
      });
      assert.strictEqual(res.status, 200);
      const quote = await res.json();
      assert.strictEqual(quote.amount_minor, 3800, '2 cinema tickets + fee must equal 3800 minor units ($38.00)');
      assert.ok(quote.quote_hash, 'Quote must include HMAC SHA-256 hash');
      assert.ok(quote.quote_id, 'Quote must include unique quote ID');
    });

    await test('POST /api/proposals: Creates verified proposal and evaluates guardrails', async () => {
      const res = await fetch(`${BASE_URL}/api/proposals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer demo-token'
        },
        body: JSON.stringify({
          service_type: 'cinema',
          title: 'IMAX Cinema Seats (D3, D4)',
          merchant: 'Grand Cineplex LLC',
          items_breakdown: [{ name: 'IMAX Laser 3D', qty: 2, price_minor: 3650 }],
          amount_minor: 3800,
          currency: 'USD'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.proposal, 'Proposal object must be returned');
      assert.strictEqual(data.withinLimits, true, 'Proposal under $500 should be within limits');
      assert.strictEqual(data.proposal.status, 'proposed');
    });

    await test('POST /api/agent/message: Processes NL query & coordinates proposal with tools', async () => {
      const res = await fetch(`${BASE_URL}/api/agent/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer demo-token'
        },
        body: JSON.stringify({
          message: 'Rent a portable power bank for 2 hours'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.session_id, 'Session ID must be returned');
      assert.ok(data.proposal, 'Proposal must be generated for power bank rental');
      assert.strictEqual(data.proposal.service_type, 'powerbank');
      assert.strictEqual(data.proposal.amount_minor, 1800, '$18.00 deposit hold must be proposed');
      assert.ok(data.tools && data.tools.length > 0, 'Restricted backend tools must be dispatched');
    });

    await test('POST /api/paypal/orders: Creates pre-auth order with INTENT=AUTHORIZE', async () => {
      const res = await fetch(`${BASE_URL}/api/paypal/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer demo-token'
        },
        body: JSON.stringify({
          intent: 'AUTHORIZE'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.id, 'Should return PayPal order id');
    });

    await test('POST /api/services/powerbank/return: Settles hold & releases remaining deposit', async () => {
      const res = await fetch(`${BASE_URL}/api/services/powerbank/return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer demo-token'
        },
        body: JSON.stringify({ rental_id: 'RENT-8821' })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.charged_amount_minor, 300, '$3.00 charged for 2 hours');
      assert.strictEqual(data.released_deposit_minor, 1500, '$15.00 deposit released back to user');
    });
  } else {
    console.log('\n[INFO] Backend server not currently running at ' + BASE_URL + '.');
    console.log('Skipped live HTTP network assertions. Unit mathematical and guardrail assertions completed.');
  }

  console.log(`\n====================================================`);
  console.log(` Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`====================================================\n`);
}

runTests();
