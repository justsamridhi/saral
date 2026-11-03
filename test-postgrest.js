require('dotenv').config();

async function testPostgrest() {
  const url = process.env.SUPABASE_URL + '/rest/v1/profiles?select=*';
  
  // Test with apikey header and Authorization header
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  console.log('Status with sb_secret:', res.status, await res.text());

  const resAnon = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY
    }
  });
  console.log('Status with sb_publishable:', resAnon.status, await resAnon.text());
}

testPostgrest().catch(console.error);

