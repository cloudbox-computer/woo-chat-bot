const fs = require('fs');
const path = require('path');

async function deployFunction(functionName) {
  const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!supabaseAccessToken) {
    console.error('SUPABASE_ACCESS_TOKEN not set');
    process.exit(1);
  }

  const projectRef = 'xsegdfcqqktxoqlbazpl';
  const functionPath = path.join(__dirname, 'supabase', 'functions', functionName, 'index.ts');

  if (!fs.existsSync(functionPath)) {
    console.error(`Function file not found: ${functionPath}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(functionPath, 'utf8');
  const encoded = Buffer.from(sourceCode).toString('base64');

  const headers = {
    'Authorization': `Bearer ${supabaseAccessToken}`,
    'Content-Type': 'application/json'
  };

  const body = JSON.stringify({
    name: functionName,
    verify_jwt: true,
    entrypoint_path: 'index.ts',
    source_code: encoded
  });

  console.log(`Deploying ${functionName}...`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions/deploy`, {
    method: 'POST',
    headers,
    body
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`Failed to deploy ${functionName}:`, data);
    process.exit(1);
  }

  console.log(`✓ ${functionName} deployed successfully`);
}

async function main() {
  const functions = process.argv.slice(2);
  if (functions.length === 0) {
    console.error('Usage: node deploy-all.js <function1> <function2> ...');
    process.exit(1);
  }

  for (const fn of functions) {
    await deployFunction(fn);
  }
}

main();
