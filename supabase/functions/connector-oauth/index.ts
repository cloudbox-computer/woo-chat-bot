import { json } from "../_shared/cors.ts";
import { dashboardIntegrationUrl, finishOAuth } from "../_shared/connectors/oauth.ts";

// Public callback endpoint. It accepts no dashboard operations and authenticates
// the callback solely with the cryptographically random, single-use OAuth state.
Deno.serve(async(req:Request)=>{
  const url=new URL(req.url);
  try{
    if(req.method!=="GET")return json({error:"Method not allowed"},405);
    const providerError=url.searchParams.get("error");
    if(providerError)return Response.redirect(dashboardIntegrationUrl({oauth:"error",message:(url.searchParams.get("error_description")||providerError).slice(0,180)}),302);
    const code=url.searchParams.get("code")??"",state=url.searchParams.get("state")??"";
    if(!code||!state)throw new Error("OAuth callback is missing code or state");
    const done=await finishOAuth(req,code,state);
    return Response.redirect(dashboardIntegrationUrl({oauth:"success",provider:done.provider,tenant:done.tenantId}),302);
  }catch(e){console.error("connector-oauth callback",e);try{return Response.redirect(dashboardIntegrationUrl({oauth:"error",message:(e instanceof Error?e.message:"OAuth connection failed").slice(0,180)}),302)}catch{return json({error:e instanceof Error?e.message:"OAuth connection failed"},400)}}
});
