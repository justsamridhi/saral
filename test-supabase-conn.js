require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function test() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const adminSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('Testing Supabase Anon connection...');
  const { data: sessionData, error: sessionErr } = await sb.auth.getSession();
  console.log('Anon getSession result:', { hasSession: !!sessionData?.session, error: sessionErr?.message });

  console.log('Testing Supabase Service Role admin connection...');
  const { data: usersData, error: usersErr } = await adminSb.auth.admin.listUsers({ page: 1, perPage: 5 });
  console.log('Admin listUsers result:', { userCount: usersData?.users?.length, error: usersErr?.message });

  console.log('Testing Profiles table query...');
  const { data: profData, error: profErr } = await adminSb.from('profiles').select('*').limit(5);
  console.log('Admin select profiles result:', { count: profData?.length, error: profErr?.message });
}

test().catch(console.error);

