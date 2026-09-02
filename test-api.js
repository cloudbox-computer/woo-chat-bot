const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhizgdfcqqktxoqlbazpsIn0.5KvM3rNl6Vx8Z9yJQ2wP1oE4tR7sA6bC8dF0gH2iJ4kL";
const out = "C:\\Users\\mazwi\\Desktop\\chatbot-system\\api-test-out.txt";

async function main() {
  const fs = require("fs");
  const write = (msg) => fs.appendFileSync(out, msg + "\n");

  try {
    // Authenticate
    const authResp = await fetch("https://xsegdfcqqktxoqlbazpl.supabase.co/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": anon },
      body: JSON.stringify({ email: "test@test.com", password: "Test1234!" })
    });
    const authData = await authResp.json();
    const token = authData.access_token;
    write("Auth OK, token len=" + token.length);

    const h2 = { "Authorization": "Bearer " + token, "apikey": anon };

    // List tenants
    const tenantsResp = await fetch("https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/dashboard?action=tenants", { headers: h2 });
    const tenantsData = await tenantsResp.json();
    write("Tenants count: " + tenantsData.tenants.length);
    tenantsData.tenants.forEach(t => write("  - " + t.name + " (id=" + t.id + ", slug=" + t.slug + ")"));

    // Find new tenant
    const newTenant = tenantsData.tenants.find(t => t.name.includes("Test") || t.name.includes("Store"));
    if (newTenant) {
      write("\nTesting config for new tenant: " + newTenant.name);
      try {
        const configResp = await fetch("https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/dashboard?action=config&tenantId=" + newTenant.id, { headers: h2 });
        const configData = await configResp.text();
        write("Config status: " + configResp.status);
        write("Config body: " + configData);
      } catch (e) {
        write("Config ERROR: " + e.message);
      }
    } else {
      write("\nNo test tenant found");
    }
  } catch (e) {
    write("ERROR: " + e.message);
  }
}

main();
