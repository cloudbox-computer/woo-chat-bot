const fs = require('fs');
const path = require('path');

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('SUPABASE_ACCESS_TOKEN not set');
    process.exit(1);
  }

  const projectRef = 'xsegdfcqqktxoqlbazpl';
  const migrationFile = path.join(__dirname, 'supabase', 'migrations', '20260911_fix_slug_uniqueness.sql');

  const sql = fs.readFileSync(migrationFile, 'utf8');
  const encoded = Buffer.from(sql).toString('base64');

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/migrations/apply`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version: '20260911',
      name: 'fix_slug_uniqueness',
      statements: sql,
      checksum: 'placeholder' // This will be rejected, but let's see
    })
  });

  const data = await res.json();
  console.log('Response:', data);
}

main();
