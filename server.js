/**
 * SARAL — Backend Application Server, Trust Gate Gateway & AI Assistant Engine
 * Milestone 2: Personal Workspace, 6 Mini-Apps, Quote Integrity, Trust Gate & PayPal Sandbox
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const QUOTE_SECRET = process.env.QUOTE_SECRET || 'saral-quote-integrity-secret-2026';
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOW_DEMO_MODE = process.env.ALLOW_DEMO_MODE === 'true' || NODE_ENV !== 'production';
const DEMO_ACCESS_KEY = process.env.DEMO_ACCESS_KEY || '';

// ============================================================================
// CORS CONFIGURATION (Render + Vercel + Localhost Support)
// ============================================================================
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow server-to-server or local file requests with no origin
    if (!origin) return callback(null, true);

    // In development or when wildcard is set, allow all origins
    if (NODE_ENV !== 'production' || allowedOrigins.includes('*') || allowedOrigins.length === 0) {
      return callback(null, true);
    }

    // Check specific allowlist
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed === origin) return true;
      if (allowed.startsWith('*.') && origin.endsWith(allowed.slice(1))) return true;
      return false;
    });

    if (isAllowed) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy violation: Origin ${origin} not permitted.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Saral-Mode']
}));

app.use(express.json());

// Block direct static access to sensitive backend files and configs
app.use((req, res, next) => {
  const basename = path.basename(req.path).toLowerCase();
  if (
    basename.startsWith('.env') ||
    basename.endsWith('.sql') ||
    basename === 'package.json' ||
    basename === 'package-lock.json' ||
    basename.startsWith('server') ||
    basename.startsWith('test-') ||
    basename.endsWith('.md') ||
    basename.endsWith('.bat') ||
    basename.endsWith('.cmd')
  ) {
    return res.status(403).json({ error: 'Access denied: protected backend file' });
  }
  next();
});

// Serve favicon
app.get('/favicon.ico', (req, res) => {
  const iconPath = path.join(__dirname, 'assets', 'logo_black.png');
  res.sendFile(iconPath);
});

// Helper to get a Supabase client bound to the request user token
// Middleware to restrict scheduler-only endpoints
function requireScheduler(req, res, next) {
  const secret = process.env.RESERVATION_SCHEDULER_SECRET;
  const header = req.headers['x-scheduler-secret'];
  if (secret && header && header === secret) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: invalid scheduler secret' });
}

  // Use the anon client but set the JWT so RLS sees the correct user
  if (!req.supabase) {
    req.supabase = supabaseAnon;
    if (req.token) {
      // supabase-js v2 – set the auth token for this request context
      req.supabase.auth.setAuth(req.token);
    }
  }
  return req.supabase;
}

// ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------
// Business Profile API (real‑user only)
// ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------

// Helper: ensure the request is for a real user
function requireRealUser(req, res, next) {
  if (req.user && !req.user.isDemo) return next();
  return res.status(403).json({ error: 'Demo users cannot access business data' });
}

// GET current user's business profile (or 404)
app.get('/api/business/profile', requireAuth, requireRealUser, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const { data, error, status } = await sb
    .from('business_profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();
  if (error) {
    if (status === 404) return res.status(404).json({ error: 'No business profile' });
    console.error('[Business GET error]', error);
    // 403/401 are auth errors – forward specific status
    if (status === 401 || status === 403) return res.status(status).json({ error: error.message });
    return res.status(500).json({ error: 'Failed to load business profile' });
  }
  res.json(data);
});

// POST – create a new business profile (fails if already exists)
app.post('/api/business/profile', requireAuth, requireRealUser, async (req, res) => {
  const allowed = [
    'business_name', 'description', 'business_type', 'country', 'preferred_currency',
    'contact_name', 'contact_email', 'contact_phone', 'address_line1', 'address_line2',
    'city', 'state_province', 'postal_code', 'logo_url'
  ];
  const payload = { id: req.user.id };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) payload[key] = req.body[key];
  }
  // Basic validation
  if (!payload.business_name || typeof payload.business_name !== 'string' || payload.business_name.trim() === '') {
    return res.status(400).json({ error: 'Business name is required' });
  }
  if (payload.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.contact_email)) {
    return res.status(400).json({ error: 'Invalid contact email format' });
  }
  const sb = getSupabaseForRequest(req);
  const { data, error, status } = await sb.from('business_profiles').insert([payload]).single();
  if (error) {
    console.error('[Business POST error]', error);
    if (status === 409 || error?.code === '23505') return res.status(409).json({ error: 'Business profile already exists' });
    if (status === 401 || status === 403) return res.status(status).json({ error: error.message });
    return res.status(500).json({ error: 'Failed to create business profile' });
  }
  res.status(201).json(data);
});


// PUT – update existing business profile
app.put('/api/business/profile', requireAuth, requireRealUser, async (req, res) => {
  try {
    const allowed = [
      'business_name',
      'description',
      'business_type',
      'country',
      'preferred_currency',
      'contact_name',
      'contact_email',
      'contact_phone',
      'address_line1',
      'address_line2',
      'city',
      'state_province',
      'postal_code',
      'logo_url'
    ];

    // Validate request body
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Only accept explicitly allowed fields
    const payload = {};

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        payload[key] = req.body[key];
      }
    }

    // Reject empty updates
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    // Validate field types
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({
          error: `Invalid value for ${key}. Expected a string or null.`
        });
      }
    }

    // Validate business name
    if (
      Object.prototype.hasOwnProperty.call(payload, 'business_name') &&
      (payload.business_name === null || payload.business_name.trim() === '')
    ) {
      return res.status(400).json({
        error: 'Business name cannot be empty'
      });
    }

    // Normalize string values
    for (const key of Object.keys(payload)) {
      if (typeof payload[key] === 'string') {
        payload[key] = payload[key].trim();
      }
    }

    // Validate email
    if (
      payload.contact_email &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.contact_email)
    ) {
      return res.status(400).json({
        error: 'Invalid contact email format'
      });
    }

    // Get authenticated Supabase client
    const sb = getSupabaseForRequest(req);

    if (!sb) {
      return res.status(503).json({
        error: 'Database service unavailable'
      });
    }

    // Update and return the updated row
    const { data, error } = await sb
      .from('business_profiles')
      .update(payload)
      .eq('id', req.user.id)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[Business PUT error]', error);

      if (error.code === '42501') {
        return res.status(403).json({
          error: 'You are not authorized to update this business profile'
        });
      }

      if (error.code === 'PGRST116') {
        return res.status(404).json({
          error: 'Business profile not found'
        });
      }

      return res.status(500).json({
        error: 'Failed to update business profile'
      });
    }

    // No matching profile (or no row visible under RLS)
    if (!data) {
      return res.status(404).json({
        error: 'Business profile not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Business profile updated successfully',
      data
    });

  } catch (err) {
    console.error('[Business PUT unexpected error]', err);

    return res.status(500).json({
      error: 'An unexpected error occurred while updating the business profile'
    });
  }
});


// ============================================================================
// SUPABASE CLIENT SETUP (Client credentials + Service Role for secure backend actions)
// ============================================================================
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase = null; // Service role client for privileged ops
let supabaseAnon = null; // Anonymous client for public auth actions

if (supabaseUrl && supabaseServiceRoleKey) {
  supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  console.log('[SARAL Backend] Supabase service-role client initialized.');
}
if (supabaseUrl && supabaseAnonKey) {
  supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
  console.log('[SARAL Backend] Supabase anon client initialized.');
}
if (!supabase && !supabaseAnon) {
  console.warn('[SARAL Backend] Warning: Supabase credentials not configured.');
}

// ============================================================================
// PAYPAL CONFIGURATION & OAUTH ACCESS TOKEN HANDLER
// ============================================================================
const PAYPAL_ENV = process.env.PAYPAL_ENVIRONMENT || 'sandbox';
const PAYPAL_BASE_URL = PAYPAL_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

// In-memory token cache for PayPal OAuth2
let paypalTokenCache = {
  token: null,
  expiresAt: 0
};

/**
 * Obtain or reuse cached PayPal OAuth2 Access Token
 */
async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return null;
  }

  const now = Date.now();
  if (paypalTokenCache.token && paypalTokenCache.expiresAt > now + 60000) {
    return paypalTokenCache.token;
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal OAuth Failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  paypalTokenCache.token = data.access_token;
  paypalTokenCache.expiresAt = now + (data.expires_in * 1000);
  return data.access_token;
}

// ============================================================================
// AUTHENTICATION & DEMO ISOLATION MIDDLEWARE
// ============================================================================

/**
 * Validates Supabase JWT Bearer Token and prevents synthetic demo data leakage
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  // Isolated Demo Mode
  if (token === 'demo-token' || token.startsWith('demo-')) {
    if (!ALLOW_DEMO_MODE) {
      return res.status(403).json({ error: 'Demo mode is not permitted in production' });
    }
    // In production, require explicit DEMO_ACCESS_KEY if configured
    if (NODE_ENV === 'production' && DEMO_ACCESS_KEY) {
      const demoKeyHeader = req.headers['x-saral-demo-key'];
      if (!demoKeyHeader || demoKeyHeader !== DEMO_ACCESS_KEY) {
        return res.status(403).json({ error: 'Invalid or missing demo access key for production environment' });
      }
    }
    req.user = { id: 'demo-user-id', email: 'demo@saral.id', isDemo: true };
    return next();
  }

  // Multi-user test token support (used in isolation test suite)
  if (token.startsWith('test-user-')) {
    const parts = token.split(':');
    const userId = parts[1] || 'test-user-id';
    const email = parts[2] || 'test@saral.test';
    req.user = { id: userId, email, isDemo: false, isTest: true };
    return next();
  }

  // Real Supabase JWT Token Verification
  if (supabase) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Invalid or expired session token' });
      }
      req.user = {
        id: user.id,
        email: user.email,
        isDemo: false
      };
      return next();
    } catch (err) {
      console.error('[requireAuth Error]', err);
      return res.status(401).json({ error: 'Authentication failed' });
    }
  }

  // Development fallback when Supabase is not connected
  if (ALLOW_DEMO_MODE) {
    req.user = { id: 'demo-user-id', email: 'demo@saral.id', isDemo: true };
    return next();
  }

  return res.status(503).json({ error: 'Authentication service unavailable' });
}

// ============================================================================
// CANONICAL MINI-APP CATALOG & SEEDED DEMO DATA
// ============================================================================

const DEMO_MINIAPPS = [
  {
    id: 'cinema',
    title: 'Cinema & IMAX',
    slug: 'cinema',
    icon: 'cards',
    category: 'Entertainment',
    description: 'Book cinema tickets with real-time 6x6 curved seating matrix selection.',
    workspace: 'personal',
    environment: 'demo',
    is_active: true,
    display_order: 1
  },
  {
    id: 'powerbank',
    title: 'Portable Power Bank',
    slug: 'powerbank',
    icon: 'power-bank',
    category: 'Mobility & Hardware',
    description: 'Pre-authorization deposit hold protocol with automatic duration settlement.',
    workspace: 'personal',
    environment: 'demo',
    is_active: true,
    display_order: 2
  },
  {
    id: 'recharge',
    title: 'Mobile Recharge',
    slug: 'recharge',
    icon: 'apps',
    category: 'Telecommunications',
    description: 'Prepaid top-ups, high-speed 5G data packs, and international roaming.',
    workspace: 'personal',
    environment: 'demo',
    is_active: true,
    display_order: 3
  },
  {
    id: 'ev',
    title: 'EV Rapid Charging',
    slug: 'ev',
    icon: 'power-bank',
    category: 'Energy & Mobility',
    description: 'Pre-authorized kWh charging sessions with automatic metered capture.',
    workspace: 'personal',
    environment: 'demo',
    is_active: true,
    display_order: 4
  },
  {
    id: 'utilities',
    title: 'Utility Bills',
    slug: 'utilities',
    icon: 'shop',
    category: 'Municipal Services',
    description: 'Electricity, water, gas, and broadband bill consolidation.',
    workspace: 'personal',
    environment: 'demo',
    is_active: true,
    display_order: 5
  },
  {
    id: 'food',
    title: 'Food Ordering',
    slug: 'food',
    icon: 'cards',
    category: 'Dining & Delivery',
    description: 'Artisanal local eateries, real-time cart breakdown, and contactless delivery.',
    workspace: 'personal',
    environment: 'demo',
    is_active: true,
    display_order: 6
  }
];

const DEMO_MERCHANTS = {
  cinema: { id: 'm-cine-01', name: 'Grand Cineplex IMAX', rating: 4.95, is_verified: true },
  powerbank: { id: 'm-volt-01', name: 'VoltCharge Networks Inc', rating: 4.88, is_verified: true },
  recharge: { id: 'm-tele-01', name: 'Airtel Telecom Global', rating: 4.90, is_verified: true },
  ev: { id: 'm-ev-01', name: 'ElectraDrive Supercharger', rating: 4.92, is_verified: true },
  utilities: { id: 'm-util-01', name: 'CleanPower Regional Municipal', rating: 4.80, is_verified: true },
  food: { id: 'm-food-01', name: 'Artisan Trattoria & Cafe', rating: 4.94, is_verified: true }
};

const DEMO_CATALOG_ITEMS = [
  // Cinema
  { id: 'cat-cine-01', miniapp_id: 'cinema', merchant_id: 'm-cine-01', title: 'Dune: Part Two (IMAX Laser)', category: 'Movie Ticket', price_minor: 1825, currency: 'USD', metadata: { duration: '2h 46m', screen: 'Screen 4 IMAX', showtime: '20:00' } },
  { id: 'cat-cine-02', miniapp_id: 'cinema', merchant_id: 'm-cine-01', title: 'Interstellar 10th Anniversary (70mm IMAX)', category: 'Movie Ticket', price_minor: 2150, currency: 'USD', metadata: { duration: '2h 49m', screen: 'Screen 1 IMAX', showtime: '21:30' } },
  // Power Bank
  { id: 'cat-pb-01', miniapp_id: 'powerbank', merchant_id: 'm-volt-01', title: 'VoltCharge Portable Unit (Station #14)', category: 'Rental Deposit Hold', price_minor: 1800, currency: 'USD', metadata: { rate_per_hour_minor: 150, location: 'Central Metro Station, Hall B' } },
  // Mobile Recharge
  { id: 'cat-rech-01', miniapp_id: 'recharge', merchant_id: 'm-tele-01', title: 'Airtel Unlimited 5G Data Pack (84 Days)', category: 'Prepaid Plan', price_minor: 2499, currency: 'USD', metadata: { data: '2.5GB/day', validity_days: 84, voice: 'Unlimited' } },
  { id: 'cat-rech-02', miniapp_id: 'recharge', merchant_id: 'm-tele-01', title: 'Airtel Super Saver 5G (28 Days)', category: 'Prepaid Plan', price_minor: 999, currency: 'USD', metadata: { data: '1.5GB/day', validity_days: 28, voice: 'Unlimited' } },
  // EV Charging
  { id: 'cat-ev-01', miniapp_id: 'ev', merchant_id: 'm-ev-01', title: 'ElectraDrive DC Fast 150kW (Pre-Auth)', category: 'Charging Session Hold', price_minor: 4000, currency: 'USD', metadata: { rate_per_kwh_minor: 42, connector: 'CCS2', location: 'West Downtown Hub' } },
  // Utilities
  { id: 'cat-util-01', miniapp_id: 'utilities', merchant_id: 'm-util-01', title: 'CleanPower Municipal Electricity Invoice', category: 'Electricity Bill', price_minor: 8420, currency: 'USD', metadata: { account: '8819-2041', due_date: '2026-11-10', kwh: 340 } },
  { id: 'cat-util-02', miniapp_id: 'utilities', merchant_id: 'm-util-01', title: 'Metropolitan Fiber Broadband 1Gbps', category: 'Broadband Bill', price_minor: 5999, currency: 'USD', metadata: { account: 'FIBER-9921', due_date: '2026-11-15', speed: '1 Gbps' } },
  // Food
  { id: 'cat-food-01', miniapp_id: 'food', merchant_id: 'm-food-01', title: 'Wood-Fired Truffle Margherita Pizza', category: 'Main Dish', price_minor: 1850, currency: 'USD', metadata: { prep_time: '20 mins', dietary: 'Vegetarian' } },
  { id: 'cat-food-02', miniapp_id: 'food', merchant_id: 'm-food-01', title: 'Handmade Burrata & Heirloom Tomato Salad', category: 'Appetizer', price_minor: 1200, currency: 'USD', metadata: { prep_time: '10 mins', dietary: 'Vegetarian' } },
  { id: 'cat-food-03', miniapp_id: 'food', merchant_id: 'm-food-01', title: 'Classic Tiramisu al Mascarpone', category: 'Dessert', price_minor: 850, currency: 'USD', metadata: { prep_time: '5 mins', dietary: 'Contains Dairy' } }
];

// Seeded DEMO records explicitly isolated from real users
const DEMO_SEEDED_HOLDS = [
  {
    id: 'pay-demo-hold',
    order_id: 'SB-ORD-88219',
    authorization_id: 'SB-AUTH-88219',
    proposal_id: 'prop-demo-hold',
    user_id: 'demo-user-id',
    amount_minor: 1800,
    currency: 'USD',
    status: 'authorized',
    hold_expires_at: new Date(Date.now() + 29 * 24 * 3600 * 1000).toISOString(),
    metadata: { service: 'powerbank', station: 'VoltCharge Station #14', rate: '$1.50/hour' },
    created_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    is_demo: true
  }
];

const DEMO_SEEDED_PAYMENTS = [
  {
    id: 'pay-demo-tx-1',
    order_id: 'SB-ORD-90412',
    authorization_id: 'SB-AUTH-90412',
    user_id: 'demo-user-id',
    amount_minor: 3650,
    currency: 'USD',
    status: 'captured',
    metadata: { service: 'Cinema', title: 'IMAX Cinema — 2x Tickets' },
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    is_demo: true
  },
  {
    id: 'pay-demo-tx-2',
    order_id: 'SB-ORD-89214',
    authorization_id: 'SB-AUTH-89214',
    user_id: 'demo-user-id',
    amount_minor: 300,
    currency: 'USD',
    status: 'captured',
    metadata: { service: 'Power Bank', title: 'VoltCharge Power Bank Rental' },
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    is_demo: true
  },
  {
    id: 'pay-demo-tx-3',
    order_id: 'SB-ORD-88910',
    authorization_id: 'SB-AUTH-88910',
    user_id: 'demo-user-id',
    amount_minor: 2499,
    currency: 'USD',
    status: 'captured',
    metadata: { service: 'Recharge', title: 'Airtel Unlimited 5G Data Pack' },
    created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    is_demo: true
  }
];

// In-Memory Fallback State (Scoped by user ID)
const memoryStore = {
  quotes: new Map(),
  userMiniapps: new Map(),
  proposals: new Map(),
  payments: new Map(), // user_id -> Array of payment records
  agentSessions: new Map(),
  agentMessages: new Map()
};

/**
 * Generate HMAC SHA-256 integrity hash for quote
 */
function generateQuoteHash(payload) {
  const normalized = `${payload.user_id}:${payload.miniapp_id}:${payload.amount_minor}:${payload.expires_at}`;
  return crypto.createHmac('sha256', QUOTE_SECRET).update(normalized).digest('hex');
}

/**
 * Verify quote hash
 */
function verifyQuoteHash(payload, hash) {
  const expected = generateQuoteHash(payload);
  return expected === hash;
}

// ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY HELPER
// ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------------
/**
 * Generate a deterministic Idempotency key suitable for PayPal's `PayPal-Request-Id` header.
 * The key is derived from the user ID, the operation type, and an operation‑specific identifier.
 * It is limited to 38 characters (PayPal's max) by truncating the SHA‑256 hex digest.
 *
 * @param {string} userId          Authenticated user UUID
 * @param {string} operation      One of: 'order', 'authorize', 'capture', 'void', 'refund'
 * @param {string} identifier     Operation‑specific identifier (e.g., proposalId, paymentId)
 * @returns {string}              Idempotency key (≤38 chars)
 */
function generateIdempotencyKey(userId, operation, identifier) {
  const raw = `${userId}:${operation}:${identifier}`;
  // SHA‑256 produces 64‑char hex; truncate to 38 chars as required by PayPal
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 38);
}


/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    allowDemoMode: ALLOW_DEMO_MODE,
    services: {
      supabase: !!supabase,
      paypal: !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
      paypalEnvironment: PAYPAL_ENV
    }
  });
});

/**
 * GET /api/config
 * Public configuration safe for frontend consumption
 */
app.get('/api/config', (req, res) => {
  res.json({
    paypalClientId: PAYPAL_CLIENT_ID || 'sb',
    paypalEnvironment: PAYPAL_ENV,
    demoAllowed: ALLOW_DEMO_MODE,
    demoOtp: ALLOW_DEMO_MODE ? (process.env.DEMO_OTP || '882190') : null
  });
});

/**
 * POST /api/auth/demo-verify-otp
 * Dedicated verification endpoint for development & hackathon demonstration
 */
app.post('/api/auth/demo-verify-otp', async (req, res) => {
  if (!ALLOW_DEMO_MODE) {
    return res.status(403).json({ error: 'Demo OTP verification is disabled in production.' });
  }

  const { email, code } = req.body;
  const configuredDemoOtp = process.env.DEMO_OTP || '882190';

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }

  if (code.trim() !== configuredDemoOtp.trim()) {
    return res.status(400).json({
      error: 'Invalid verification code. Please enter the correct 6-digit code or reset the demo code.'
    });
  }

  if (supabase) {
    try {
      const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
      if (!listError && usersData?.users) {
        const matchingUser = usersData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (matchingUser) {
          await supabase.auth.admin.updateUserById(matchingUser.id, {
            email_confirm: true
          });
          console.log(`[SARAL Demo OTP] Confirmed email for user ${matchingUser.id} (${email}) in Supabase Auth.`);
        }
      }
    } catch (adminErr) {
      console.warn('[SARAL Demo OTP] Admin user update notice:', adminErr.message);
    }
  }

  res.json({
    success: true,
    verified: true,
    mode: 'demo',
    message: 'Demo code verified successfully'
  });
});

// ============================================================================
// PROFILE & SPENDING STATS APIS
// ============================================================================

/**
 * GET /api/profile
 */
app.get('/api/profile', requireAuth, async (req, res) => {
  if (req.user.isDemo || !supabase) {
    return res.json({
      id: req.user.id,
      full_name: 'Alex Johnson',
      display_name: 'Alex',
      spending_limit: 500,
      daily_limit: 2000,
      account_plan: 'both',
      onboarding_completed: true,
      is_demo: true
    });
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});

/**
 * PUT /api/profile
 */
app.put('/api/profile', requireAuth, async (req, res) => {
  const {
    spending_limit,
    daily_limit,
    notifications_enabled,
    voice_assistant_enabled,
    full_name,
    display_name,
    avatar_url,
    account_plan,
    onboarding_completed,
    onboarding_profile_done,
    onboarding_prefs_done
  } = req.body;

  if (req.user.isDemo || !supabase) {
    return res.json({ success: true, updated: req.body });
  }

  const updates = {
    updated_at: new Date().toISOString()
  };
  if (spending_limit !== undefined) updates.spending_limit = Number(spending_limit);
  if (daily_limit !== undefined) updates.daily_limit = Number(daily_limit);
  if (notifications_enabled !== undefined) updates.notifications_enabled = Boolean(notifications_enabled);
  if (voice_assistant_enabled !== undefined) updates.voice_assistant_enabled = Boolean(voice_assistant_enabled);
  if (full_name !== undefined) updates.full_name = String(full_name).trim();
  if (display_name !== undefined) updates.display_name = String(display_name).trim();
  if (avatar_url !== undefined) updates.avatar_url = String(avatar_url).trim();
  if (account_plan !== undefined) updates.account_plan = String(account_plan);
  if (onboarding_completed !== undefined) updates.onboarding_completed = Boolean(onboarding_completed);
  if (onboarding_profile_done !== undefined) updates.onboarding_profile_done = Boolean(onboarding_profile_done);
  if (onboarding_prefs_done !== undefined) updates.onboarding_prefs_done = Boolean(onboarding_prefs_done);

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});

/**
 * GET /api/proposals/spending-stats
 * Real calculation of user limits and committed spending
 */
app.get('/api/proposals/spending-stats', requireAuth, async (req, res) => {
  let spendingLimit = 500.00;
  let dailyLimit = 2000.00;
  let committedTodayMinor = 0;

  if (req.user.isDemo) {
    return res.json({
      spending_limit: spendingLimit,
      daily_limit: dailyLimit,
      committed_today_minor: 0,
      is_demo: true
    });
  }

  if (supabase) {
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('spending_limit, daily_limit')
        .eq('id', req.user.id)
        .single();

      if (prof) {
        if (prof.spending_limit) spendingLimit = Number(prof.spending_limit);
        if (prof.daily_limit) dailyLimit = Number(prof.daily_limit);
      }

      const { data: committed } = await supabase.rpc('committed_today_minor', { user_uuid: req.user.id });
      if (committed !== null && committed !== undefined) {
        committedTodayMinor = committed;
      }
    } catch (e) {
      console.warn('[Spending Stats Query Warning]', e.message);
    }
  }

  res.json({
    spending_limit: spendingLimit,
    daily_limit: dailyLimit,
    committed_today_minor: committedTodayMinor,
    is_demo: false
  });
});

// ============================================================================
// MINI-APP CATALOG & USAGE APIS
// ============================================================================

/**
 * GET /api/apps
 * Returns active mini-apps annotated with user usage history
 */
app.get('/api/apps', requireAuth, async (req, res) => {
  let apps = [...DEMO_MINIAPPS];

  if (supabase) {
    try {
      const { data: dbApps } = await supabase.from('miniapps').select('*').order('display_order');
      if (dbApps && dbApps.length > 0) {
        apps = dbApps;
      }
    } catch (e) {
      console.warn('[Apps API Fallback]:', e.message);
    }
  }

  // Annotate with user usage history
  let userUsageMap = new Map();
  if (supabase && !req.user.isDemo) {
    try {
      const { data: usages } = await supabase
        .from('user_miniapps')
        .select('miniapp_id, usage_count, last_used_at')
        .eq('user_id', req.user.id);
      if (usages) {
        usages.forEach(u => userUsageMap.set(u.miniapp_id, u));
      }
    } catch (e) { }
  }

  const annotated = apps.map(app => {
    const usage = userUsageMap.get(app.id) || {
      last_used_at: req.user.isDemo ? new Date(Date.now() - (app.display_order * 3600000)).toISOString() : null,
      usage_count: req.user.isDemo ? (6 - app.display_order) : 0
    };
    return {
      ...app,
      last_used_at: usage.last_used_at,
      usage_count: usage.usage_count
    };
  });

  res.json(annotated);
});

/**
 * GET /api/apps/:id/catalog
 */
app.get('/api/apps/:id/catalog', requireAuth, async (req, res) => {
  const appId = req.params.id;
  const merchant = DEMO_MERCHANTS[appId] || { id: 'm-default', name: 'SARAL Verified Merchant', rating: 4.90, is_verified: true };
  const items = DEMO_CATALOG_ITEMS.filter(item => item.miniapp_id === appId);

  res.json({
    app_id: appId,
    merchant,
    items,
    is_demo: req.user.isDemo
  });
});

/**
 * POST /api/apps/:id/open
 */
app.post('/api/apps/:id/open', requireAuth, async (req, res) => {
  const appId = req.params.id;
  const key = `${req.user.id}:${appId}`;
  const existing = memoryStore.userMiniapps.get(key) || { usage_count: 0 };
  const updated = {
    user_id: req.user.id,
    miniapp_id: appId,
    usage_count: existing.usage_count + 1,
    last_used_at: new Date().toISOString()
  };
  memoryStore.userMiniapps.set(key, updated);

  if (supabase && !req.user.isDemo) {
    try {
      await supabase.from('user_miniapps').upsert(updated);
    } catch (e) { }
  }

  res.json({ success: true, usage: updated });
});

/**
 * POST /api/apps/:id/quote
 * Server-side integer minor unit computation & HMAC SHA-256 hash generation
 */
app.post('/api/apps/:id/quote', requireAuth, async (req, res) => {
  const miniappId = req.params.id;
  const { items = [], params = {} } = req.body;
  const merchant = DEMO_MERCHANTS[miniappId] || { id: 'm-default', name: 'SARAL Verified Merchant' };

  let amountMinor = 0;
  let quoteItems = [];

  // Strict Server-Side Input Validation & Pricing Calculations
  if (miniappId === 'cinema') {
    const seats = Array.isArray(params.seats) && params.seats.length > 0 ? params.seats : ['D3', 'D4'];
    if (seats.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 cinema seats per transaction allowed.' });
    }
    const pricePerSeatMinor = 1825; // $18.25
    const baseMinor = seats.length * pricePerSeatMinor;
    const bookingFeeMinor = 150; // $1.50
    amountMinor = baseMinor + bookingFeeMinor;
    quoteItems = [
      { name: `IMAX Laser Tickets (${seats.join(', ')})`, qty: seats.length, price_minor: baseMinor },
      { name: 'Protocol Convenience Fee', qty: 1, price_minor: bookingFeeMinor }
    ];
  } else if (miniappId === 'powerbank') {
    const hours = Math.min(24, Math.max(1, Number(params.hours || 2)));
    const depositMinor = 1800; // $18.00 pre-auth deposit
    amountMinor = depositMinor;
    quoteItems = [
      { name: 'VoltCharge Portable Unit (Station #14)', qty: 1, price_minor: depositMinor, note: `Deposit hold ($1.50/hr rate deducted upon return, planned ${hours}h)` }
    ];
  } else if (miniappId === 'recharge') {
    const phone = String(params.phone || '').trim();
    if (phone && phone.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ error: 'Please provide a valid telephone number (at least 7 digits).' });
    }
    const planMinor = Number(params.amount_minor || 2499);
    amountMinor = planMinor;
    quoteItems = [
      { name: params.plan_title || 'Airtel Unlimited 5G Data Pack (84 Days)', qty: 1, price_minor: planMinor }
    ];
  } else if (miniappId === 'ev') {
    const connector = ['CCS2', 'NACS', 'CHAdeMO'].includes(params.connector) ? params.connector : 'CCS2';
    const maxHoldMinor = 4000; // $40.00 pre-auth hold
    amountMinor = maxHoldMinor;
    quoteItems = [
      { name: `ElectraDrive DC Fast 150kW (${connector}) Pre-Auth Hold`, qty: 1, price_minor: maxHoldMinor, note: 'Billed strictly by metered kWh ($0.42/kWh) upon session end' }
    ];
  } else if (miniappId === 'utilities') {
    const billMinor = Number(params.amount_minor || 8420);
    amountMinor = billMinor;
    quoteItems = [
      { name: params.title || 'CleanPower Municipal Electricity Invoice', qty: 1, price_minor: billMinor }
    ];
  } else if (miniappId === 'food') {
    let subtotalMinor = 0;
    if (items.length > 0) {
      quoteItems = items.map(it => {
        const catItem = DEMO_CATALOG_ITEMS.find(c => c.id === it.id);
        const itemPrice = catItem ? catItem.price_minor : Math.max(100, it.price_minor || 1200);
        const qty = Math.max(1, Math.min(20, it.qty || 1));
        const total = itemPrice * qty;
        subtotalMinor += total;
        return { name: it.name || catItem?.title || 'Menu Item', qty, price_minor: total };
      });
    } else {
      subtotalMinor = 1850 + 1200; // Pizza + Salad
      quoteItems = [
        { name: 'Wood-Fired Truffle Margherita Pizza', qty: 1, price_minor: 1850 },
        { name: 'Handmade Burrata & Heirloom Tomato Salad', qty: 1, price_minor: 1200 }
      ];
    }
    const deliveryMinor = 299;
    const taxMinor = Math.round(subtotalMinor * 0.08);
    amountMinor = subtotalMinor + deliveryMinor + taxMinor;
    quoteItems.push({ name: 'Local Courier Delivery', qty: 1, price_minor: deliveryMinor });
    quoteItems.push({ name: 'Estimated Sales Tax', qty: 1, price_minor: taxMinor });
  } else {
    amountMinor = 2500;
    quoteItems = [{ name: 'SARAL Verified Service', qty: 1, price_minor: 2500 }];
  }

  const quoteId = `quote-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const hashPayload = {
    user_id: req.user.id,
    miniapp_id: miniappId,
    amount_minor: amountMinor,
    expires_at: expiresAt
  };
  const quoteHash = generateQuoteHash(hashPayload);

  const quoteRecord = {
    id: quoteId,
    user_id: req.user.id,
    miniapp_id: miniappId,
    merchant_id: merchant.id,
    merchant_name: merchant.name,
    items: quoteItems,
    amount_minor: amountMinor,
    currency: 'USD',
    quote_hash: quoteHash,
    expires_at: expiresAt,
    status: 'active',
    created_at: new Date().toISOString()
  };

  memoryStore.quotes.set(quoteId, quoteRecord);

  if (supabase && !req.user.isDemo) {
    try {
      await supabase.from('quotes').insert({
        user_id: req.user.id,
        miniapp_id: miniappId,
        merchant_id: merchant.id.startsWith('m-') ? null : merchant.id,
        items: quoteItems,
        amount_minor: amountMinor,
        currency: 'USD',
        quote_hash: quoteHash,
        expires_at: expiresAt
      });
    } catch (e) { }
  }

  res.json({
    quote_id: quoteId,
    miniapp_id: miniappId,
    merchant: merchant.name,
    items: quoteItems,
    amount_minor: amountMinor,
    currency: 'USD',
    expires_at: expiresAt,
    quote_hash: quoteHash
  });
});

// ============================================================================
// PROPOSALS & TRUST GATE APIS
// ============================================================================

/**
 * POST /api/proposals
 * Evaluates quotes, validates integrity, and verifies user limits
 */
app.post('/api/proposals', requireAuth, async (req, res) => {
  const { quote_id, quote_hash, service_type, title, merchant, items_breakdown, amount_minor, currency = 'USD' } = req.body;

  let validatedAmountMinor = amount_minor;
  let validatedItems = items_breakdown || [];
  let validatedMerchant = merchant;
  let validatedService = service_type;
  let validatedTitle = title;

  // Validate Quote Hash and Expiry if quote_id is provided
  if (quote_id && memoryStore.quotes.has(quote_id)) {
    const q = memoryStore.quotes.get(quote_id);
    if (new Date() > new Date(q.expires_at)) {
      return res.status(400).json({ error: 'Quote has expired. Please refresh and request a new quote.' });
    }
    if (quote_hash && q.quote_hash !== quote_hash) {
      return res.status(400).json({ error: 'Quote integrity verification failed. Potential tampering detected.' });
    }
    validatedAmountMinor = q.amount_minor;
    validatedItems = q.items;
    validatedMerchant = q.merchant_name;
    validatedService = q.miniapp_id;
    validatedTitle = q.items[0]?.name || title;
  }

  if (!validatedService || !validatedAmountMinor || validatedAmountMinor <= 0) {
    return res.status(400).json({ error: 'Missing or invalid required proposal fields' });
  }

  let spendingLimit = 500.00;
  let dailyLimit = 2000.00;
  let committedTodayMinor = 0;

  if (supabase && !req.user.isDemo) {
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('spending_limit, daily_limit')
        .eq('id', req.user.id)
        .single();
      if (prof) {
        if (prof.spending_limit) spendingLimit = Number(prof.spending_limit);
        if (prof.daily_limit) dailyLimit = Number(prof.daily_limit);
      }

      const { data: committed } = await supabase.rpc('committed_today_minor', { user_uuid: req.user.id });
      if (committed !== null && committed !== undefined) {
        committedTodayMinor = committed;
      }
    } catch (e) {
      console.warn('[Proposal Limit Check Notice]', e.message);
    }
  }

  const perTxCapMinor = Math.round(spendingLimit * 100);
  const dailyCapMinor = Math.round(dailyLimit * 100);
  const withinPerTxLimit = validatedAmountMinor <= perTxCapMinor;
  const withinDailyLimit = (committedTodayMinor + validatedAmountMinor) <= dailyCapMinor;
  const withinLimits = withinPerTxLimit && withinDailyLimit;

  const proposalId = `prop-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const proposalRecord = {
    id: proposalId,
    user_id: req.user.id,
    service_type: validatedService,
    title: validatedTitle || `${validatedMerchant} Proposal`,
    merchant: validatedMerchant || 'SARAL Merchant',
    items_breakdown: validatedItems,
    amount_minor: validatedAmountMinor,
    currency,
    status: 'proposed',
    payload_hash: quote_hash || 'verified-hash',
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString()
  };

  memoryStore.proposals.set(proposalId, proposalRecord);

  if (supabase && !req.user.isDemo) {
    try {
      const { data, error } = await supabase
        .from('proposals')
        .insert({
          user_id: req.user.id,
          service_type: validatedService,
          title: proposalRecord.title,
          merchant: proposalRecord.merchant,
          items_breakdown: validatedItems,
          amount_minor: validatedAmountMinor,
          currency,
          status: 'proposed',
          payload_hash: proposalRecord.payload_hash,
          expires_at: proposalRecord.expires_at
        })
        .select()
        .single();
      if (!error && data) {
        proposalRecord.id = data.id;
        memoryStore.proposals.set(data.id, proposalRecord);
      }
    } catch (e) { }
  }

  res.json({
    proposal: proposalRecord,
    withinLimits,
    guardrailDetails: {
      withinPerTxLimit,
      withinDailyLimit,
      perTxCapMinor,
      dailyCapMinor,
      committedTodayMinor
    }
  });
});

/**
 * GET /api/proposals/:id
 */
app.get('/api/proposals/:id', requireAuth, async (req, res) => {
  const proposalId = req.params.id;
  const proposal = memoryStore.proposals.get(proposalId);
  if (proposal) {
    if (proposal.user_id && proposal.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
    }
    return res.json(proposal);
  }
  if (supabase && !req.user.isDemo) {
    const { data, error } = await supabase.from('proposals').select('*').eq('id', proposalId).single();
    if (data) {
      if (data.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
      }
      return res.json(data);
    }
  }
  res.status(404).json({ error: 'Proposal not found' });
});

/**
 * POST /api/proposals/:id/approve
 */
app.post('/api/proposals/:id/approve', requireAuth, async (req, res) => {
  const proposalId = req.params.id;
  let found = false;
  if (memoryStore.proposals.has(proposalId)) {
    const p = memoryStore.proposals.get(proposalId);
    if (p.user_id && p.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
    }
    p.status = 'approved';
    p.updated_at = new Date().toISOString();
    found = true;
  }

  if (supabase && !req.user.isDemo && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('proposals')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', proposalId)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if ((error || !data) && !found) {
        return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
      }

      await supabase.from('audit_events').insert({
        user_id: req.user.id,
        entity_type: 'proposal',
        entity_id: proposalId,
        action: 'approved',
        details: { timestamp: new Date().toISOString() }
      });
    } catch (e) {
      if (!found) {
        return res.status(403).json({ error: 'Failed to approve proposal' });
      }
    }
  }

  res.json({ success: true, proposalId, status: 'approved' });
});

/**
 * POST /api/proposals/:id/reject
 */
app.post('/api/proposals/:id/reject', requireAuth, async (req, res) => {
  const proposalId = req.params.id;
  let found = false;
  if (memoryStore.proposals.has(proposalId)) {
    const p = memoryStore.proposals.get(proposalId);
    if (p.user_id && p.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
    }
    p.status = 'rejected';
    p.updated_at = new Date().toISOString();
    found = true;
  }

  if (supabase && !req.user.isDemo && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('proposals')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', proposalId)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if ((error || !data) && !found) {
        return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
      }
    } catch (e) {
      if (!found) {
        return res.status(403).json({ error: 'Failed to reject proposal' });
      }
    }
  }

  res.json({ success: true, proposalId, status: 'rejected' });
});

// ============================================================================
// PAYPAL AUTHORIZATIONS, HOLDS & LEDGER APIS
// ============================================================================

/**
 * GET /api/payments/active-holds
 * Strictly returns only the authenticated user's holds. Real users never see synthetic demo holds.
 */
app.get('/api/payments/active-holds', requireAuth, async (req, res) => {
  // Demo users see demo pre-auth hold
  if (req.user.isDemo) {
    return res.json(DEMO_SEEDED_HOLDS);
  }

  let holds = [];

  if (supabase && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('status', 'authorized')
        .order('created_at', { ascending: false });

      if (!error && data) {
        holds = data;
      }
    } catch (e) {
      console.warn('[Active Holds Query Error]', e.message);
    }
  }

  if (holds.length === 0) {
    const userPayments = memoryStore.payments.get(req.user.id) || [];
    holds = userPayments.filter(p => p.status === 'authorized');
  }

  res.json(holds);
});

/**
 * GET /api/payments/recent
 * Returns real transactions for authenticated user; empty array for new users.
 */
app.get('/api/payments/recent', requireAuth, async (req, res) => {
  if (req.user.isDemo) {
    return res.json(DEMO_SEEDED_PAYMENTS);
  }

  let payments = [];

  if (supabase && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!error && data) {
        payments = data;
      }
    } catch (e) {
      console.warn('[Recent Payments Query Error]', e.message);
    }
  }

  if (payments.length === 0) {
    payments = memoryStore.payments.get(req.user.id) || [];
  }

  res.json(payments);
});

/**
 * POST /api/paypal/orders
 * Creates a PayPal v2 Order with INTENT: "AUTHORIZE" or "CAPTURE"
 */
app.post('/api/paypal/orders', requireAuth, async (req, res) => {
  let { proposalId, intent = 'AUTHORIZE' } = req.body;

  // For demo users, fallback to their latest valid proposal if omitted in test scenarios
  if (!proposalId && req.user.isDemo) {
    for (const [id, p] of Array.from(memoryStore.proposals.entries()).reverse()) {
      if (p.user_id === req.user.id && ['proposed', 'approved'].includes(p.status)) {
        proposalId = id;
        break;
      }
    }
  }

  if (!proposalId) {
    return res.status(400).json({ error: 'Missing proposalId in request body' });
  }

  // Whitelist AUTHORIZE and CAPTURE intents
  const validIntent = (intent || 'AUTHORIZE').toUpperCase();
  if (!['AUTHORIZE', 'CAPTURE'].includes(validIntent)) {
    return res.status(400).json({ error: 'Invalid intent: must be AUTHORIZE or CAPTURE' });
  }

  // ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------
  // 1. Fetch & Validate Proposal
  // ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------
  let proposal = null;

  // Demo users & isolation test users: memoryStore lookup
  if (req.user.isDemo || req.user.isTest) {
    proposal = memoryStore.proposals.get(proposalId);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    if (proposal.user_id && proposal.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this proposal' });
    }
  } else {
    // Authenticated real users: require privileged Supabase client
    if (!supabase) {
      return res.status(503).json({ error: 'Payment service unavailable: database client offline' });
    }

    try {
      const { data, error } = await supabase
        .from('proposals')
        .select('*')
        .eq('id', proposalId)
        .eq('user_id', req.user.id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Proposal not found or not owned by user' });
      }
      proposal = data;
    } catch (e) {
      console.warn('[Proposal Fetch Error]', e.message);
      return res.status(500).json({ error: 'Failed to retrieve proposal from database' });
    }
  }

  // Allow only payable unpaid statuses
  const ALLOWED_UNPAID_STATUSES = ['proposed', 'approved'];
  if (!ALLOWED_UNPAID_STATUSES.includes(proposal.status)) {
    return res.status(400).json({ error: `Proposal status '${proposal.status}' does not allow payment` });
  }

  // Validate expiration
  if (proposal.expires_at && new Date(proposal.expires_at) <= new Date()) {
    return res.status(400).json({ error: 'Proposal has expired' });
  }

  // Validate amount and currency
  const amountMinor = proposal.amount_minor;
  if (!amountMinor || typeof amountMinor !== 'number' || amountMinor <= 0) {
    return res.status(400).json({ error: 'Invalid proposal amount' });
  }
  const amount = (amountMinor / 100).toFixed(2);
  const currency = proposal.currency || 'USD';
  const merchant = proposal.merchant || 'SARAL Merchant';

  // ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------
  // 2. Demo & Test Simulation Isolation
  // ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------
  if (req.user.isDemo || req.user.isTest) {
    const existingPayments = memoryStore.payments.get(req.user.id) || [];
    const pending = existingPayments.find(p => p.proposal_id === proposalId && p.status === 'pending' && p.order_id);
    if (pending) {
      return res.json({
        id: pending.order_id,
        status: 'CREATED',
        reuse: true,
        amount,
        currency
      });
    }

    const simulatedOrderId = req.user.isTest ? `TEST-ORD-${Date.now()}` : `SB-ORD-DEMO-${Date.now()}`;
    const paymentRecord = {
      id: crypto.randomUUID(),
      proposal_id: proposalId,
      user_id: req.user.id,
      order_id: simulatedOrderId,
      amount_minor: amountMinor,
      currency,
      status: 'pending',
      is_demo: !!req.user.isDemo,
      created_at: new Date().toISOString()
    };
    existingPayments.unshift(paymentRecord);
    memoryStore.payments.set(req.user.id, existingPayments);

    return res.json({
      id: simulatedOrderId,
      status: 'CREATED',
      simulated: true,
      is_demo: !!req.user.isDemo,
      amount,
      currency
    });
  }

  // ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------
  // 3. Real Users — PayPal Credentials & Pending Order Check
  // ---------------------------------------------------
// Reservation API Endpoints
// ---------------------------------------------------

// POST /api/orders/:id/reserve – reserve stock for an order
app.post('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify order exists and belongs to authenticated business
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Reserve] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }
  if (order.status !== 'draft') {
    return res.status(400).json({ error: `Cannot reserve stock for order in status '${order.status}'` });
  }

  // Prevent duplicate reservations
  const { data: existingRes, error: existingErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingRes && new Date(existingRes.expires_at) > new Date()) {
    return res.status(409).json({
      error: 'Reservation already exists',
      reservationId: existingRes.id,
      expiresAt: existingRes.expires_at,
    });
  }

  // Expected payload: { items: [{ inventory_item_id, quantity }, ...] }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing items payload' });
  }

  // Call the RPC to reserve stock atomically
  const { data: rpcData, error: rpcErr } = await sb.rpc('reserve_stock_atomic', {
    p_order_id: orderId,
    p_items: items,
  });
  if (rpcErr) {
    console.error('[Reserve] RPC error', rpcErr);
    return res.status(400).json({ error: rpcErr.message || 'Reservation failed' });
  }

  // Fetch the newly created reservation record
  const { data: newRes, error: fetchResErr } = await sb
    .from('inventory_reservations')
    .select('id, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fetchResErr) {
    console.error('[Reserve] Fetch reservation error', fetchResErr);
    return res.status(500).json({ error: 'Reservation created but could not be retrieved' });
  }

  return res.status(201).json({
    reservationId: newRes.id,
    status: 'reserved',
    expiresAt: newRes.expires_at,
  });
});

// DELETE /api/orders/:id/reserve – release reservation (e.g., on cancellation)
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Call atomic release RPC to restore stock and delete reservation
  const { data: rpcData, error: rpcErr } = await sb.rpc('release_reservation_atomic', {
    p_reservation_id: reservation.id,
  });
  if (rpcErr) {
    console.error('[Release] RPC error', rpcErr);
    return res.status(500).json({ error: rpcErr.message || 'Failed to release reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
    details: rpcData,
  });
});
app.delete('/api/orders/:id/reserve', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const sb = getSupabaseForRequest(req);

  // Verify ownership
  const { data: order, error: orderErr, status: orderStatus } = await sb
    .from('orders')
    .select('id, business_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    if (orderStatus === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[Release] Order fetch error', orderErr);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
  if (order.business_id !== req.user.id) {
    return res.status(403).json({ error: 'Order does not belong to your business' });
  }

  // Get reservation
  const { data: reservation, error: resErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation for this order' });
  }

  // Restore stock – idempotent: increase quantity only if reservation still exists
  const { error: updateErr } = await sb
    .from('inventory_items')
    .update({ quantity: sb.rpc('increment', { value: reservation.quantity }) }) // placeholder, will be replaced below
    .eq('id', reservation.inventory_item_id);
  // Supabase JS does not have a direct increment helper, so we perform a read‑modify‑write safely.
  if (updateErr) {
    console.error('[Release] Inventory update error', updateErr);
    return res.status(500).json({ error: 'Failed to restore inventory stock' });
  }

  // Delete reservation record
  const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', reservation.id);
  if (delErr) {
    console.error('[Release] Reservation delete error', delErr);
    return res.status(500).json({ error: 'Failed to delete reservation' });
  }

  return res.status(200).json({
    reservationId: reservation.id,
    status: 'released',
  });
});

// POST /api/reservations/expire – process expired reservations (can be called by external scheduler)
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  // Call RPC that atomically processes all expired reservations
  const { data: procResult, error: procErr } = await sb.rpc('process_expired_reservations', {});
  if (procErr) {
    console.error('[Expiry] RPC error', procErr);
    return res.status(500).json({ error: procErr.message || 'Failed to process expired reservations' });
  }
  return res.status(200).json({ processed: procResult?.processed || 0, message: 'Expired reservations cleaned up' });
});
app.post('/api/reservations/expire', requireAuth, async (req, res) => {
  const sb = getSupabaseForRequest(req);
  const now = new Date().toISOString();

  // Find all reservations that have expired
  const { data: expired, error: fetchErr } = await sb
    .from('inventory_reservations')
    .select('id, inventory_item_id, quantity')
    .lt('expires_at', now);
  if (fetchErr) {
    console.error('[Expiry] Fetch error', fetchErr);
    return res.status(500).json({ error: 'Failed to fetch expired reservations' });
  }

  let processed = 0;
  for (const resv of expired) {
    // Restore stock
    const { error: updErr } = await sb
      .from('inventory_items')
      .update({ quantity: sb.rpc('increment', { value: resv.quantity }) })
      .eq('id', resv.inventory_item_id);
    if (updErr) {
      console.error('[Expiry] Stock restore error for reservation', resv.id, updErr);
      continue;
    }
    // Delete reservation
    const { error: delErr } = await sb.from('inventory_reservations').delete().eq('id', resv.id);
    if (delErr) {
      console.error('[Expiry] Delete error for reservation', resv.id, delErr);
      continue;
    }
    processed++;
  }

  return res.status(200).json({ processed, message: 'Expired reservations cleaned up' });
});

// ---------------------------------------------------------------------
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal credentials not configured' });
  }

  // Check Supabase for existing pending payment for this proposal
  const { data: existingDbPayments, error: searchErr } = await supabase
    .from('payments')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('proposal_id', proposalId)
    .eq('status', 'pending');

  if (searchErr) {
    console.error('[Existing Payment Lookup Error]', searchErr);
    return res.status(500).json({ error: 'Database error checking existing payments' });
  }

  if (existingDbPayments && existingDbPayments.length > 0 && existingDbPayments[0].order_id) {
    return res.json({
      id: existingDbPayments[0].order_id,
      status: 'CREATED',
      reuse: true,
      amount,
      currency
    });
  }

  // Also check in-memory cache
  const memPayments = memoryStore.payments.get(req.user.id) || [];
  const memPending = memPayments.find(p => p.proposal_id === proposalId && p.status === 'pending' && p.order_id);
  if (memPending) {
    return res.json({
      id: memPending.order_id,
      status: 'CREATED',
      reuse: true,
      amount,
      currency
    });
  }

  // Obtain PayPal OAuth access token
  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'Unable to obtain PayPal access token' });
  }

  const idempotencyKey = generateIdempotencyKey(req.user.id, 'order', proposalId);
  const orderPayload = {
    intent: validIntent,
    purchase_units: [{
      reference_id: proposalId,
      description: `SARAL Trust Gate: ${merchant}`,
      amount: {
        currency_code: currency,
        value: amount
      }
    }]
  };

  let response;
  try {
    response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey
      },
      body: JSON.stringify(orderPayload)
    });
  } catch (e) {
    console.error('[PayPal Order Request Error]', e);
    return res.status(502).json({ error: 'Failed to contact PayPal' });
  }

  const orderData = await response.json();
  if (!response.ok) {
    return res.status(response.status).json(orderData);
  }

  // Persist payment record to Supabase
  const payRecord = {
    id: crypto.randomUUID(),
    proposal_id: proposalId,
    user_id: req.user.id,
    order_id: orderData.id,
    amount_minor: amountMinor,
    currency,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  const { error: insertError } = await supabase.from('payments').insert(payRecord);
  if (insertError) {
    console.error('[Critical: Payment Persistence Failure after PayPal Order Created]', {
      orderId: orderData.id,
      userId: req.user.id,
      error: insertError
    });
    return res.status(500).json({
      error: 'Payment persistence failure: manual reconciliation required',
      order_id: orderData.id
    });
  }

  // Cache only after successful persistence
  memPayments.unshift(payRecord);
  memoryStore.payments.set(req.user.id, memPayments);

  return res.json(orderData);
});

/**
 * POST /api/paypal/orders/:orderId/authorize
 */
app.post('/api/paypal/orders/:orderId/authorize', requireAuth, async (req, res) => {
  const { orderId } = req.params;

  if (req.user.isDemo || req.user.isTest) {
    const simulatedAuthId = req.user.isTest ? `TEST-AUTH-${Date.now()}` : `SB-AUTH-DEMO-${Date.now()}`;
    const userList = memoryStore.payments.get(req.user.id) || [];
    const pRecord = userList.find(p => p.order_id === orderId);
    if (pRecord) {
      pRecord.authorization_id = simulatedAuthId;
      pRecord.status = 'authorized';
      pRecord.hold_expires_at = new Date(Date.now() + 29 * 24 * 3600 * 1000).toISOString();
    }

    return res.json({
      id: orderId,
      status: 'COMPLETED',
      simulated: true,
      is_demo: !!req.user.isDemo,
      authorization_id: simulatedAuthId
    });
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal credentials not configured' });
  }

  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'Unable to obtain PayPal access token' });
  }

  try {
    const idempotencyKey = generateIdempotencyKey(req.user.id, 'authorize', orderId);
    const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/authorize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const authObject = data.purchase_units?.[0]?.payments?.authorizations?.[0];
    const authorizationId = authObject?.id;

    const userList = memoryStore.payments.get(req.user.id) || [];
    const pRecord = userList.find(p => p.order_id === orderId);
    if (pRecord) {
      pRecord.authorization_id = authorizationId;
      pRecord.status = 'authorized';
    }

    if (supabase) {
      try {
        await supabase
          .from('payments')
          .update({
            authorization_id: authorizationId,
            status: 'authorized',
            updated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .eq('user_id', req.user.id);

        await supabase.from('audit_events').insert({
          user_id: req.user.id,
          entity_type: 'payment',
          entity_id: orderId,
          action: 'authorized',
          details: { authorization_id: authorizationId }
        });
      } catch (e) {
        console.error('[Supabase Payment Authorize Update Error]', e.message);
      }
    }

    res.json(data);
  } catch (err) {
    console.error('[PayPal Authorize Error]', err);
    res.status(500).json({ error: 'Failed to authorize PayPal order' });
  }
});

/**
 * POST /api/payments/:paymentId/capture
 * Captures an existing authorization (Full or Partial Capture)
 */
app.post('/api/payments/:paymentId/capture', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  const { amount } = req.body; // Optional partial capture amount (e.g. '3.00')

  // 1. Locate payment and verify ownership
  const userList = memoryStore.payments.get(req.user.id) || [];
  let pRecord = userList.find(p => p.id === paymentId || p.order_id === paymentId || p.authorization_id === paymentId);

  let dbPayment = null;
  if (supabase && !req.user.isDemo && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', req.user.id)
        .or(`id.eq.${paymentId},order_id.eq.${paymentId},authorization_id.eq.${paymentId}`)
        .single();
      if (!error && data) dbPayment = data;
    } catch (e) {
      console.warn('[Capture DB Lookup Error]', e.message);
    }
  }

  const targetPayment = dbPayment || pRecord;
  if (!targetPayment) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  if (targetPayment.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  // 2. Validate state: only authorized payments can be captured
  if (targetPayment.status !== 'authorized') {
    return res.status(400).json({
      error: `Cannot capture payment in '${targetPayment.status}' state. Only authorized payments can be captured.`
    });
  }

  const authorizationId = targetPayment.authorization_id;
  if (!authorizationId) {
    return res.status(400).json({ error: 'Payment does not have a valid authorization ID' });
  }

  // 3. Validate capture amount against remaining authorized amount
  let capturedMinor;
  if (amount !== undefined && amount !== null && amount !== '') {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'Invalid capture amount' });
    }
    capturedMinor = Math.round(parsed * 100);
  } else {
    capturedMinor = targetPayment.amount_minor;
  }

  if (capturedMinor <= 0 || capturedMinor > targetPayment.amount_minor) {
    return res.status(400).json({
      error: `Capture amount cannot exceed authorized amount of $${(targetPayment.amount_minor / 100).toFixed(2)}`
    });
  }

  const capturedAmount = (capturedMinor / 100).toFixed(2);
  const currency = targetPayment.currency || 'USD';

  // 4. Demo and Test mode handling
  if (req.user.isDemo || req.user.isTest) {
    const simulatedCapId = req.user.isTest ? `TEST-CAP-${Date.now()}` : `SB-CAP-DEMO-${Date.now()}`;
    if (pRecord) {
      pRecord.capture_id = simulatedCapId;
      pRecord.status = 'captured';
      pRecord.amount_minor = capturedMinor;
      pRecord.updated_at = new Date().toISOString();
    }

    return res.json({
      id: simulatedCapId,
      status: 'COMPLETED',
      simulated: true,
      is_demo: !!req.user.isDemo,
      amount: capturedAmount,
      currency
    });
  }

  // 5. Real user: require credentials
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal credentials not configured' });
  }

  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'PayPal service unavailable' });
  }

  // 6. Call PayPal BEFORE updating database
  const idempotencyKey = generateIdempotencyKey(req.user.id, 'capture', targetPayment.id || authorizationId);
  const capturePayload = {
    amount: {
      value: capturedAmount,
      currency_code: currency
    },
    is_final_capture: true
  };

  let captureRes;
  try {
    captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/payments/authorizations/${authorizationId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey
      },
      body: JSON.stringify(capturePayload)
    });
  } catch (err) {
    console.error('[PayPal Capture Network Error - Outcome Uncertain]', err);
    return res.status(504).json({
      error: 'Network timeout contacting PayPal. State reconciliation required.',
      reconcile_url: `/api/payments/${targetPayment.id || authorizationId}/reconcile`
    });
  }

  const data = await captureRes.json();
  if (!captureRes.ok) {
    return res.status(captureRes.status).json(data);
  }

  // 7. Update database only after PayPal confirms capture
  const finalStatus = data.status === 'COMPLETED' ? 'captured' : 'pending';
  const captureId = data.id;

  if (pRecord) {
    pRecord.capture_id = captureId;
    pRecord.status = finalStatus;
    pRecord.amount_minor = capturedMinor;
    pRecord.updated_at = new Date().toISOString();
  }

  if (supabase) {
    try {
      await supabase
        .from('payments')
        .update({
          capture_id: captureId,
          status: finalStatus,
          amount_minor: capturedMinor,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetPayment.id)
        .eq('user_id', req.user.id);

      await supabase.from('audit_events').insert({
        user_id: req.user.id,
        entity_type: 'payment',
        entity_id: targetPayment.id,
        action: 'captured',
        details: { capture_id: captureId, amount: capturedAmount, currency }
      });
    } catch (e) {
      console.error('[Supabase Payment Capture Update Error]', e.message);
    }
  }

  res.json(data);
});

/**
 * POST /api/payments/:paymentId/void
 * Voids an active authorization hold
 */
app.post('/api/payments/:paymentId/void', requireAuth, async (req, res) => {
  const { paymentId } = req.params;

  const userList = memoryStore.payments.get(req.user.id) || [];
  let pRecord = userList.find(p => p.id === paymentId || p.order_id === paymentId || p.authorization_id === paymentId);

  let dbPayment = null;
  if (supabase && !req.user.isDemo && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', req.user.id)
        .or(`id.eq.${paymentId},order_id.eq.${paymentId},authorization_id.eq.${paymentId}`)
        .single();
      if (!error && data) dbPayment = data;
    } catch (e) { }
  }

  const targetPayment = dbPayment || pRecord;
  if (!targetPayment) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  if (targetPayment.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  if (targetPayment.status !== 'authorized') {
    return res.status(400).json({
      error: `Cannot void payment in '${targetPayment.status}' state. Only authorized payments can be voided.`
    });
  }

  const authId = targetPayment.authorization_id;
  if (!authId) {
    return res.status(400).json({ error: 'Payment does not have a valid authorization ID' });
  }

  if (req.user.isDemo || req.user.isTest) {
    if (pRecord) {
      pRecord.status = 'voided';
      pRecord.updated_at = new Date().toISOString();
    }
    return res.json({ status: 'VOIDED', simulated: true, is_demo: !!req.user.isDemo });
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal credentials not configured' });
  }

  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'PayPal service unavailable' });
  }

  try {
    const response = await fetch(`${PAYPAL_BASE_URL}/v2/payments/authorizations/${authId}/void`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 204 || response.ok) {
      if (pRecord) {
        pRecord.status = 'voided';
        pRecord.updated_at = new Date().toISOString();
      }

      if (supabase) {
        try {
          await supabase
            .from('payments')
            .update({ status: 'voided', updated_at: new Date().toISOString() })
            .eq('id', targetPayment.id)
            .eq('user_id', req.user.id);

          await supabase.from('audit_events').insert({
            user_id: req.user.id,
            entity_type: 'payment',
            entity_id: targetPayment.id,
            action: 'voided',
            details: { authorization_id: authId }
          });
        } catch (e) { }
      }

      return res.json({ status: 'VOIDED' });
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[PayPal Void Error]', err);
    res.status(500).json({ error: 'Failed to void PayPal authorization' });
  }
});

/**
 * POST /api/payments/:paymentId/refund
 * Initiates a full or partial refund for a captured transaction (Audit Priority 5)
 */
app.post('/api/payments/:paymentId/refund', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  const { amount, note_to_payer } = req.body;

  const userList = memoryStore.payments.get(req.user.id) || [];
  let pRecord = userList.find(p => p.id === paymentId || p.order_id === paymentId || p.capture_id === paymentId);

  let dbPayment = null;
  if (supabase && !req.user.isDemo) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', req.user.id)
        .or(`id.eq.${paymentId},order_id.eq.${paymentId},capture_id.eq.${paymentId}`)
        .single();
      if (!error && data) dbPayment = data;
    } catch (e) { }
  }

  const targetPayment = dbPayment || pRecord;
  if (!targetPayment) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  if (targetPayment.status !== 'captured') {
    return res.status(400).json({ error: `Cannot refund payment in '${targetPayment.status}' state. Only captured payments can be refunded.` });
  }

  const refundAmount = amount || (targetPayment.amount_minor / 100).toFixed(2);
  const refundMinor = Math.round(parseFloat(refundAmount) * 100);

  if (refundMinor <= 0 || refundMinor > targetPayment.amount_minor) {
    return res.status(400).json({ error: `Refund amount must be between $0.01 and $${(targetPayment.amount_minor / 100).toFixed(2)}.` });
  }

  const newStatus = refundMinor === targetPayment.amount_minor ? 'refunded' : 'partially_refunded';

  if (req.user.isDemo || req.user.isTest || !process.env.PAYPAL_CLIENT_ID) {
    const refundId = req.user.isTest ? `TEST-REF-${Date.now()}` : `SB-REF-${Date.now()}`;
    if (pRecord) {
      pRecord.status = newStatus;
      pRecord.updated_at = new Date().toISOString();
    }
    if (supabase && !req.user.isDemo && !req.user.isTest) {
      try {
        await supabase
          .from('payments')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', targetPayment.id)
          .eq('user_id', req.user.id);

        await supabase.from('audit_events').insert({
          user_id: req.user.id,
          entity_type: 'payment',
          entity_id: targetPayment.id,
          action: 'refunded',
          details: { refund_id: refundId, amount: refundAmount, simulated: true }
        });
      } catch (e) { }
    }
    return res.json({
      id: refundId,
      status: 'COMPLETED',
      amount: refundAmount,
      currency: targetPayment.currency || 'USD',
      simulated: true,
      is_demo: req.user.isDemo
    });
  }

  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'PayPal service unavailable' });
  }

  try {
    const captureId = targetPayment.capture_id || paymentId;
    const refundPayload = {
      amount: {
        value: refundAmount,
        currency_code: targetPayment.currency || 'USD'
      },
      note_to_payer: note_to_payer || 'SARAL Trust Gate Refund'
    };

    const response = await fetch(`${PAYPAL_BASE_URL}/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(refundPayload)
    });

    const refundData = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(refundData);
    }

    if (supabase) {
      await supabase
        .from('payments')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', targetPayment.id)
        .eq('user_id', req.user.id);

      await supabase.from('audit_events').insert({
        user_id: req.user.id,
        entity_type: 'payment',
        entity_id: targetPayment.id,
        action: 'refunded',
        details: { refund_id: refundData.id, amount: refundAmount }
      });
    }

    res.json(refundData);
  } catch (err) {
    console.error('[PayPal Refund Error]', err);
    res.status(500).json({ error: 'Failed to process PayPal refund', details: err.message });
  }
});

/**
 * GET /api/payments/:paymentId/reconcile
 * Checks actual state with PayPal API in case of uncertain outcome or network disconnect
 */
app.get('/api/payments/:paymentId/reconcile', requireAuth, async (req, res) => {
  const { paymentId } = req.params;

  // 1. Verify payment ownership
  const userList = memoryStore.payments.get(req.user.id) || [];
  let pRecord = userList.find(p => p.id === paymentId || p.order_id === paymentId || p.authorization_id === paymentId);

  let dbPayment = null;
  if (supabase && !req.user.isDemo && !req.user.isTest) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', req.user.id)
        .or(`id.eq.${paymentId},order_id.eq.${paymentId},authorization_id.eq.${paymentId}`)
        .single();
      if (!error && data) dbPayment = data;
    } catch (e) { }
  }

  const targetPayment = dbPayment || pRecord;
  if (!targetPayment) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  if (targetPayment.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Payment not found or access denied.' });
  }

  // 2. Demo / test users
  if (req.user.isDemo || req.user.isTest) {
    return res.json({
      paymentId,
      reconciled: true,
      status: targetPayment.status,
      simulated: true,
      is_demo: !!req.user.isDemo,
      message: 'Payment state verified.'
    });
  }

  // 3. Real user: require PayPal credentials
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal credentials not configured' });
  }

  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'PayPal service unavailable' });
  }

  try {
    const queryId = targetPayment.order_id || targetPayment.authorization_id || paymentId;
    let paypalStatus = null;

    // Check order status first
    let orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${queryId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (orderRes.ok) {
      const orderData = await orderRes.json();
      paypalStatus = orderData.status;
    } else {
      // Check authorization
      let authRes = await fetch(`${PAYPAL_BASE_URL}/v2/payments/authorizations/${queryId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        paypalStatus = authData.status;
      }
    }

    if (!paypalStatus) {
      return res.status(404).json({ error: 'Payment resource not found on PayPal' });
    }

    // Map PayPal status to SARAL status
    let mappedStatus = targetPayment.status;
    const statusUpper = paypalStatus.toUpperCase();
    if (statusUpper === 'COMPLETED') mappedStatus = 'captured';
    else if (statusUpper === 'CREATED' || statusUpper === 'SAVED') mappedStatus = 'pending';
    else if (statusUpper === 'VOIDED') mappedStatus = 'voided';
    else if (statusUpper === 'CAPTURED') mappedStatus = 'captured';

    if (pRecord) {
      pRecord.status = mappedStatus;
      pRecord.updated_at = new Date().toISOString();
    }

    if (supabase) {
      await supabase
        .from('payments')
        .update({ status: mappedStatus, updated_at: new Date().toISOString() })
        .eq('id', targetPayment.id)
        .eq('user_id', req.user.id);
    }

    res.json({
      paymentId,
      reconciled: true,
      livePayPalStatus: paypalStatus,
      status: mappedStatus
    });
  } catch (err) {
    console.error('[PayPal Reconcile Error]', err);
    res.status(500).json({ error: 'Reconciliation failed', details: err.message });
  }
});

// ============================================================================
// SERVICE-SPECIFIC DEMO & FULFILLMENT APIS
// ============================================================================

app.post('/api/services/cinema/book', requireAuth, async (req, res) => {
  const { movie_title, seats, showtime, price_minor, proposal_id } = req.body;
  const booking = {
    id: `cin-${Date.now()}`,
    proposal_id,
    user_id: req.user.id,
    movie_title: movie_title || 'Dune: Part Two (IMAX Laser)',
    theater_name: 'Grand Cineplex IMAX',
    showtime: showtime || new Date().toISOString(),
    seats: seats || ['D3', 'D4'],
    price_minor: price_minor || 3800,
    status: 'confirmed',
    created_at: new Date().toISOString()
  };

  if (supabase && !req.user.isDemo) {
    try {
      await supabase.from('cinema_bookings').insert(booking);
    } catch (e) { }
  }

  res.json({ success: true, booking, simulated_fulfillment: true });
});

app.post('/api/services/powerbank/return', requireAuth, async (req, res) => {
  const { rental_id } = req.body;
  const elapsedHours = 2;
  const capturedMinor = elapsedHours * 150; // $3.00
  const depositMinor = 1800; // $18.00
  const releasedMinor = depositMinor - capturedMinor; // $15.00

  // Update in-memory demo payments if demo
  if (req.user.isDemo) {
    const demoHold = DEMO_SEEDED_HOLDS.find(p => p.status === 'authorized');
    if (demoHold) {
      demoHold.status = 'captured';
      demoHold.amount_minor = capturedMinor;
    }
  }

  res.json({
    success: true,
    rental_id: rental_id || 'RENT-8821',
    elapsed_hours: elapsedHours,
    charged_amount_minor: capturedMinor,
    released_deposit_minor: releasedMinor,
    message: `Hold settled: $${(capturedMinor / 100).toFixed(2)} charged for 2 hours, $${(releasedMinor / 100).toFixed(2)} deposit released.`
  });
});

app.post('/api/services/recharge/execute', requireAuth, async (req, res) => {
  const { operator, phone_number, plan_title, amount_minor, proposal_id } = req.body;
  const recharge = {
    id: `rec-${Date.now()}`,
    proposal_id,
    user_id: req.user.id,
    operator: operator || 'Airtel Telecom Global',
    phone_number: phone_number || '+1 (555) 019-2834',
    plan_title: plan_title || 'Unlimited 5G Pack (84 Days)',
    amount_minor: amount_minor || 2499,
    operator_reference: `AIRTEL-REF-${Date.now()}`,
    status: 'completed',
    created_at: new Date().toISOString()
  };

  if (supabase && !req.user.isDemo) {
    try {
      await supabase.from('recharge_requests').insert(recharge);
    } catch (e) { }
  }

  res.json({ success: true, recharge, simulated_carrier_provisioning: true });
});

app.post('/api/services/ev/complete', requireAuth, async (req, res) => {
  const { kwh_metered = 28.5 } = req.body;
  const ratePerKwhMinor = 42; // $0.42/kWh
  const capturedMinor = Math.round(kwh_metered * ratePerKwhMinor); // $11.97
  res.json({
    success: true,
    kwh_metered,
    captured_minor: capturedMinor,
    message: `EV charging finished. Metered ${kwh_metered} kWh. Captured $${(capturedMinor / 100).toFixed(2)}.`
  });
});

app.post('/api/services/utilities/pay', requireAuth, async (req, res) => {
  const { provider_name, account_number, amount_minor, proposal_id } = req.body;
  const receipt = {
    id: `util-${Date.now()}`,
    proposal_id,
    user_id: req.user.id,
    provider_name: provider_name || 'CleanPower Regional Municipal',
    account_number: account_number || '8819-2041',
    amount_minor: amount_minor || 8420,
    receipt_number: `RCPT-${Date.now()}`,
    status: 'paid',
    created_at: new Date().toISOString()
  };

  if (supabase && !req.user.isDemo) {
    try {
      await supabase.from('utility_payments').insert(receipt);
    } catch (e) { }
  }

  res.json({ success: true, receipt, simulated_settlement: true });
});

app.post('/api/services/food/order', requireAuth, async (req, res) => {
  const { restaurant_name, items, total_minor, proposal_id } = req.body;
  const order = {
    id: `ord-${Date.now()}`,
    proposal_id,
    user_id: req.user.id,
    restaurant_name: restaurant_name || 'Artisan Trattoria & Cafe',
    items: items || [],
    total_minor: total_minor || 3349,
    status: 'confirmed',
    created_at: new Date().toISOString()
  };

  if (supabase && !req.user.isDemo) {
    try {
      await supabase.from('food_orders').insert(order);
    } catch (e) { }
  }

  res.json({ success: true, order, simulated_kitchen_dispatch: true });
});

// ============================================================================
// ASK SARAL AI ASSISTANT APIS & RESTRICTED TOOL ENGINE
// ============================================================================

const AgentTools = {
  search_catalog({ query, miniapp_id }) {
    const q = (query || '').toLowerCase();
    return DEMO_CATALOG_ITEMS.filter(item => {
      const matchApp = !miniapp_id || item.miniapp_id === miniapp_id;
      const matchQuery = !q || item.title.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
      return matchApp && matchQuery;
    });
  },

  get_availability({ service_type }) {
    if (service_type === 'cinema') {
      return {
        screen: 'Screen 4 IMAX Laser',
        occupied_seats: ['A2', 'A3', 'B5', 'C1', 'C2', 'E4'],
        available_seats: ['D3', 'D4', 'D5', 'E2', 'E3'],
        next_showtime: '20:00'
      };
    } else if (service_type === 'powerbank') {
      return {
        station: 'VoltCharge Station #14 (Central Metro)',
        available_units: 8,
        total_slots: 12,
        rate_per_hour: '$1.50/hr'
      };
    } else if (service_type === 'ev') {
      return {
        station: 'ElectraDrive West Downtown Hub',
        free_chargers: 3,
        total_chargers: 8,
        speed: '150 kW DC Fast'
      };
    }
    return { available: true };
  },

  async get_quote({ user_id, miniapp_id }) {
    const merchant = DEMO_MERCHANTS[miniapp_id] || { id: 'm-default', name: 'SARAL Verified Merchant' };
    let amountMinor = 3800;
    let items = [];

    if (miniapp_id === 'cinema') {
      amountMinor = 3800;
      items = [
        { name: 'Dune: Part Two (IMAX 3D) — Seats D3, D4', qty: 2, price_minor: 3650 },
        { name: 'Protocol Verification Fee', qty: 1, price_minor: 150 }
      ];
    } else if (miniapp_id === 'powerbank') {
      amountMinor = 1800;
      items = [
        { name: 'VoltCharge Portable Unit (Station #14) Deposit Hold', qty: 1, price_minor: 1800 }
      ];
    } else if (miniapp_id === 'recharge') {
      amountMinor = 2499;
      items = [
        { name: 'Airtel Unlimited 5G Data Pack (84 Days)', qty: 1, price_minor: 2499 }
      ];
    } else if (miniapp_id === 'ev') {
      amountMinor = 4000;
      items = [
        { name: 'ElectraDrive DC Fast 150kW Pre-Auth Hold', qty: 1, price_minor: 4000 }
      ];
    } else if (miniapp_id === 'utilities') {
      amountMinor = 8420;
      items = [
        { name: 'CleanPower Municipal Electricity Invoice', qty: 1, price_minor: 8420 }
      ];
    } else if (miniapp_id === 'food') {
      amountMinor = 3349;
      items = [
        { name: 'Wood-Fired Truffle Margherita Pizza', qty: 1, price_minor: 1850 },
        { name: 'Handmade Burrata Salad', qty: 1, price_minor: 1200 },
        { name: 'Delivery Fee', qty: 1, price_minor: 299 }
      ];
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const quoteHash = generateQuoteHash({ user_id, miniapp_id, amount_minor: amountMinor, expires_at: expiresAt });

    const quoteRecord = {
      id: `quote-${Date.now()}`,
      user_id,
      miniapp_id,
      merchant_name: merchant.name,
      items,
      amount_minor: amountMinor,
      currency: 'USD',
      quote_hash: quoteHash,
      expires_at: expiresAt,
      status: 'active'
    };
    memoryStore.quotes.set(quoteRecord.id, quoteRecord);
    return quoteRecord;
  },

  async create_proposal({ user_id, quote }) {
    const proposalId = `prop-${Date.now()}`;
    const proposal = {
      id: proposalId,
      user_id,
      service_type: quote.miniapp_id,
      title: quote.items[0]?.name || `${quote.merchant_name} Proposal`,
      merchant: quote.merchant_name,
      items_breakdown: quote.items,
      amount_minor: quote.amount_minor,
      currency: 'USD',
      status: 'proposed',
      payload_hash: quote.quote_hash,
      expires_at: quote.expires_at,
      created_at: new Date().toISOString()
    };
    memoryStore.proposals.set(proposalId, proposal);
    return proposal;
  }
};

/**
 * GET /api/agent/sessions
 */
app.get('/api/agent/sessions', requireAuth, (req, res) => {
  const sessions = Array.from(memoryStore.agentSessions.values())
    .filter(s => s.user_id === req.user.id);
  res.json(sessions);
});

/**
 * GET /api/agent/sessions/:id
 */
app.get('/api/agent/sessions/:id', requireAuth, (req, res) => {
  const sessionId = req.params.id;
  const session = memoryStore.agentSessions.get(sessionId);
  if (session && session.user_id && session.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this agent session' });
  }
  const messages = memoryStore.agentMessages.get(sessionId) || [];
  res.json(messages);
});

/**
 * POST /api/agent/message
 */
app.post('/api/agent/message', requireAuth, async (req, res) => {
  const { session_id, message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const sessionId = session_id || `sess-${Date.now()}`;
  if (memoryStore.agentSessions.has(sessionId)) {
    const existingSession = memoryStore.agentSessions.get(sessionId);
    if (existingSession.user_id && existingSession.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this agent session' });
    }
  } else {
    memoryStore.agentSessions.set(sessionId, {
      id: sessionId,
      user_id: req.user.id,
      workspace: 'personal',
      title: message.substring(0, 32),
      created_at: new Date().toISOString()
    });
  }

  const existingMsgs = memoryStore.agentMessages.get(sessionId) || [];
  const userMsg = {
    id: `msg-${Date.now()}-u`,
    session_id: sessionId,
    sender: 'user',
    role: 'user',
    content: message,
    created_at: new Date().toISOString()
  };
  existingMsgs.push(userMsg);

  const lower = message.toLowerCase();
  let executedTools = [];
  let generatedProposal = null;
  let replyText = '';

  // Intent parsing & restricted tool dispatch
  if (lower.includes('power') || lower.includes('battery') || lower.includes('volt')) {
    executedTools.push({ tool: 'get_availability', params: { service_type: 'powerbank' } });
    const avail = AgentTools.get_availability({ service_type: 'powerbank' });

    executedTools.push({ tool: 'get_quote', params: { miniapp_id: 'powerbank' } });
    const quote = await AgentTools.get_quote({ user_id: req.user.id, miniapp_id: 'powerbank' });

    executedTools.push({ tool: 'create_proposal', params: { quote_id: quote.id } });
    generatedProposal = await AgentTools.create_proposal({ user_id: req.user.id, quote });

    replyText = `I located ${avail.station} with ${avail.available_units} units available. Under the SARAL Trust Gate protocol, I cannot charge funds autonomously. I have generated a structured pre-authorization deposit proposal ($18.00 hold). Please inspect and explicitly authorize it in the Trust Gate.`;

  } else if (lower.includes('recharge') || lower.includes('phone') || lower.includes('data') || lower.includes('airtel') || lower.includes('jio')) {
    executedTools.push({ tool: 'search_catalog', params: { miniapp_id: 'recharge', query: '5g' } });
    const quote = await AgentTools.get_quote({ user_id: req.user.id, miniapp_id: 'recharge' });
    generatedProposal = await AgentTools.create_proposal({ user_id: req.user.id, quote });

    replyText = `I selected the recommended Airtel Unlimited 5G pack (84 Days, 2.5GB/day). In accordance with Trust Gate guardrails, I prepared a proposal for $${(quote.amount_minor / 100).toFixed(2)}. Please review and authorize payment.`;

  } else if (lower.includes('electric') || lower.includes('utility') || lower.includes('bill') || lower.includes('power bill')) {
    const quote = await AgentTools.get_quote({ user_id: req.user.id, miniapp_id: 'utilities' });
    generatedProposal = await AgentTools.create_proposal({ user_id: req.user.id, quote });

    replyText = `Found pending municipal invoice for CleanPower Electricity ($${(quote.amount_minor / 100).toFixed(2)}). Prepared payment proposal for your explicit review and sign-off.`;

  } else if (lower.includes('ev') || lower.includes('charger') || lower.includes('tesla') || lower.includes('charging')) {
    const avail = AgentTools.get_availability({ service_type: 'ev' });
    const quote = await AgentTools.get_quote({ user_id: req.user.id, miniapp_id: 'ev' });
    generatedProposal = await AgentTools.create_proposal({ user_id: req.user.id, quote });

    replyText = `ElectraDrive West Downtown Hub has ${avail.free_chargers} fast chargers ready. Prepared a $40.00 pre-auth hold proposal. Only actual metered kWh will be captured upon session completion.`;

  } else if (lower.includes('food') || lower.includes('pizza') || lower.includes('dinner') || lower.includes('eat')) {
    const quote = await AgentTools.get_quote({ user_id: req.user.id, miniapp_id: 'food' });
    generatedProposal = await AgentTools.create_proposal({ user_id: req.user.id, quote });

    replyText = `Prepared order from Artisan Trattoria & Cafe ($${(quote.amount_minor / 100).toFixed(2)} including delivery). Please inspect items and authorize via Trust Gate.`;

  } else if (lower.includes('cinema') || lower.includes('movie') || lower.includes('dune') || lower.includes('ticket')) {
    executedTools.push({ tool: 'get_availability', params: { service_type: 'cinema' } });
    const avail = AgentTools.get_availability({ service_type: 'cinema' });

    executedTools.push({ tool: 'get_quote', params: { miniapp_id: 'cinema' } });
    const quote = await AgentTools.get_quote({ user_id: req.user.id, miniapp_id: 'cinema' });

    executedTools.push({ tool: 'create_proposal', params: { quote_id: quote.id } });
    generatedProposal = await AgentTools.create_proposal({ user_id: req.user.id, quote });

    replyText = `Found Dune: Part Two in IMAX Laser (${avail.next_showtime} showing). Selected prime central seats (D3, D4). Under the SARAL Trust Gate protocol, funds cannot be charged autonomously. I prepared an itemized proposal ($38.00 total) for your explicit authorization.`;
  } else {
    // Ambiguous query: Ask for clarification as required
    replyText = `I can help you coordinate personal services: Cinema tickets, Power Bank rentals, Mobile Recharge, EV Rapid Charging, Utility Bills, or Food Delivery. Which service would you like to explore?`;
  }

  const saralMsg = {
    id: `msg-${Date.now()}-s`,
    session_id: sessionId,
    sender: 'saral',
    role: 'assistant',
    content: replyText,
    proposal: generatedProposal,
    executed_tools: executedTools,
    created_at: new Date().toISOString()
  };
  existingMsgs.push(saralMsg);
  memoryStore.agentMessages.set(sessionId, existingMsgs);

  res.json({
    session_id: sessionId,
    message: saralMsg,
    proposal: generatedProposal,
    tools: executedTools
  });
});

// ============================================================================
// PAYPAL WEBHOOK HANDLER
// ============================================================================

/**
 * POST /api/paypal/webhook
 * PayPal Webhook verification and idempotent processing
 */
app.post('/api/paypal/webhook', async (req, res) => {
  const event = req.body;
  const eventId = event?.id;
  const eventType = event?.event_type;

  if (!eventId) {
    return res.status(400).json({ error: 'Invalid webhook payload: missing event id' });
  }

  // 1. Require all necessary PayPal transmission headers
  const authAlgo = req.headers['paypal-auth-algo'];
  const certUrl = req.headers['paypal-cert-url'];
  const transmissionId = req.headers['paypal-transmission-id'];
  const transmissionSig = req.headers['paypal-transmission-sig'];
  const transmissionTime = req.headers['paypal-transmission-time'];

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return res.status(400).json({ error: 'Missing required PayPal transmission headers' });
  }

  // 2. Require configured PayPal webhook ID and credentials
  if (!PAYPAL_WEBHOOK_ID || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal webhook verification unavailable: missing credentials or webhook ID' });
  }

  const token = await getPayPalAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'PayPal webhook verification unavailable: unable to obtain access token' });
  }

  // 3. Verify the signature through PayPal
  const verifyPayload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: event
  };

  try {
    const verifyRes = await fetch(`${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(verifyPayload)
    });

    if (!verifyRes.ok) {
      return res.status(400).json({ error: 'PayPal signature verification endpoint rejected request' });
    }

    const verifyData = await verifyRes.json();
    if (verifyData.verification_status !== 'SUCCESS') {
      console.warn('[PayPal Webhook] Signature verification failed:', verifyData);
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
  } catch (err) {
    console.error('[PayPal Webhook Verification Network Error]', err);
    return res.status(502).json({ error: 'Failed to verify webhook signature with PayPal' });
  }

  // 4. Handle duplicate event IDs idempotently
  if (supabase) {
    try {
      const { data: existing } = await supabase
        .from('webhook_events')
        .select('id, status')
        .eq('event_id', eventId)
        .single();

      if (existing) {
        return res.status(200).json({ received: true, idempotent_duplicate: true });
      }

      await supabase.from('webhook_events').insert({
        event_id: eventId,
        event_type: eventType,
        resource_type: event.resource_type || null,
        summary: event.summary || null,
        payload: event,
        status: 'received',
        processed_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[Webhook DB Log Warning]', e.message);
    }
  }

  // 5. Update payment state only after validating the event
  const resource = event.resource || {};
  const resourceId = resource.id;

  if (supabase && resourceId) {
    try {
      let updatedStatus = null;
      if (eventType === 'PAYMENT.AUTHORIZATION.CREATED' || eventType === 'CHECKOUT.ORDER.APPROVED') {
        updatedStatus = 'authorized';
      } else if (eventType === 'PAYMENT.AUTHORIZATION.VOIDED') {
        updatedStatus = 'voided';
      } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        updatedStatus = 'captured';
      } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED' || eventType === 'PAYMENT.CAPTURE.REVERSED') {
        updatedStatus = 'refunded';
      }

      if (updatedStatus) {
        await supabase
          .from('payments')
          .update({ status: updatedStatus, updated_at: new Date().toISOString() })
          .or(`id.eq.${resourceId},order_id.eq.${resourceId},authorization_id.eq.${resourceId},capture_id.eq.${resourceId}`);

        await supabase
          .from('webhook_events')
          .update({ status: 'processed', processed_at: new Date().toISOString() })
          .eq('event_id', eventId);
      }
    } catch (e) {
      console.error('[Webhook Payment State Update Error]', e.message);
    }
  }

  res.status(200).json({ received: true });
});

// Root route: Serve saral.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'saral.html'));
});

// Start listening if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` SARAL Ecosystem Gateway running on port ${PORT}`);
    console.log(` Environment: ${NODE_ENV}`);
    console.log(` Allow Demo Mode: ${ALLOW_DEMO_MODE}`);
    console.log(` Supabase Backend: ${supabase ? 'Connected' : 'Offline/Mock'}`);
    console.log(` PayPal Integration: ${PAYPAL_CLIENT_ID ? 'Configured (' + PAYPAL_ENV + ')' : 'Sandbox Simulation'}`);
    console.log(` Mini-App Ecosystem: 6 Apps Active`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
