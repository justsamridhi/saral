require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function check() {
  const adminSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Test querying other tables
  const tables = ['proposals', 'payments', 'miniapps', 'user_miniapps', 'webhook_events', 'audit_events'];
  for (const t of tables) {
    const { data, error } = await adminSb.from(t).select('*').limit(1);
    console.log(`Table ${t}:`, error ? `ERROR: ${error.message}` : `OK (${data?.length} rows)`);
  }
}

check().catch(console.error);

