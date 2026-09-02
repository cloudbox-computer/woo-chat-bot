const fs = require('fs');
const path = require('path');

async function deploy() {
  const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!supabaseAccessToken) {
    console.error('SUPABASE_ACCESS_TOKEN not set');
    process.exit(1);
  }

  const projectRef = 'xsegdfcqqktxoqlbazpl';
  const functionName = 'dashboard';
  const functionPath = path.join('C:\\Users\\mazwi\\Desktop\\chatbot-system', 'supabase', 'functions', functionName, 'index.ts');

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

  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions/${functionName}`, {
      method: 'PUT',
      headers,
      body
    });

    const text = await res.text();
    if (res.ok) {
      console.log('SUCCESS!');
      console.log(text);
    } else {
      console.error('FAILED');
      console.error(text);
      process.exit(1);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

deploy();
