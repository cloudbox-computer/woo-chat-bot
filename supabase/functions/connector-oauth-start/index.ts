import { DashboardError, resolveDashboardContext, requireDashboardRole } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { requirePlanFeature } from "../_shared/entitlements.ts";
import { startOAuth } from "../_shared/connectors/oauth.ts";

// Authenticated OAuth initiation endpoint. Gateway JWT verification remains ON.
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return handleOptions();
  try{
    if(req.method!=="POST")throw new DashboardError("Method not allowed",405);
    const url=new URL(req.url);const tenantId=url.searchParams.get("tenantId")?.trim();const provider=url.searchParams.get("provider")?.trim();
    if(!tenantId||!provider)throw new DashboardError("tenantId and provider are required");
    const ctx=await resolveDashboardContext(req,tenantId);requireDashboardRole(ctx,"admin");requirePlanFeature(ctx.tenant,"liveIntegrations");
    return json(await startOAuth(req,tenantId,ctx.user.id,provider));
  }catch(e){const status=e instanceof DashboardError?e.status:400;console.error("connector-oauth-start",e);return json({error:e instanceof Error?e.message:"Could not start OAuth"},status)}
});
