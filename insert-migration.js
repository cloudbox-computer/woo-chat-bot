const https = require('https');

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('SUPABASE_ACCESS_TOKEN not set');
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationFile, 'utf8');
  const projectRef = 'xsegdfcqqktxoqlbazpl';

  // First, insert the migration record manually
  const insertSql = `
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260911', 'fix_slug_uniqueness')
ON CONFLICT (version) DO NOTHING;
`;

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/sql`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql: insertSql })
  });

  console.log('Insert result:', res.status);
  const data = await res.json();
  console.log('Data:', JSON.stringify(data, null, 2));
}

main();
