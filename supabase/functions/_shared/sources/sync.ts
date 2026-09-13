import { supabaseConfig } from "../env.ts";
import { decryptSecret } from "../secrets.ts";

export interface SourceRow {
  id: string;
  tenant_id: string;
  chatbot_id: string;
  kind: "file"|"website"|"sitemap"|"url"|"text"|"qa"|"notion"|"google_drive"|"dropbox"|"zendesk";
  name: string;
  status: string;
  config: Record<string, unknown>;
  connection_provider?: string | null;
  object_path?: string | null;
  sync_interval_minutes?: number | null;
}

interface IndexedDocument {
  externalId: string;
  title: string;
  sourceUrl?: string;
  mimeType?: string;
  contentHash?: string;
  byteSize?: number;
  metadata?: Record<string, unknown>;
  chunks: Array<{ index: number; content: string; metadata?: Record<string, unknown> }>;
}

const MAX_DOCUMENTS_PER_SOURCE = 1000;
const MAX_TEXT_PER_DOCUMENT = 2_000_000;
const MAX_TOTAL_TEXT = 15_000_000;
const USER_AGENT = "ZoChatSourceBot/1.0 (+https://zochat.ai)";

function cfg() {
  const { url, serviceRoleKey } = supabaseConfig();
  return { root: url.replace(/\/+$/g, ""), key: serviceRoleKey };
}
function dbHeaders() {
  const { key } = cfg();
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
async function dbRows(path: string, query: Record<string,string>): Promise<Record<string,unknown>[]> {
  const { root } = cfg();
  const r = await fetch(`${root}/rest/v1/${path}?${new URLSearchParams(query)}`, { headers: dbHeaders() });
  if (!r.ok) throw new Error(`Database read failed (${r.status})`);
  return r.json();
}
async function dbPatch(path: string, body: Record<string,unknown>): Promise<void> {
  const { root } = cfg();
  const r = await fetch(`${root}/rest/v1/${path}`, { method:"PATCH", headers:{...dbHeaders(),Prefer:"return=minimal"}, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`Database update failed (${r.status})`);
}

export async function getSource(sourceId: string): Promise<SourceRow | null> {
  const rows = await dbRows("data_sources", { id:`eq.${sourceId}`, select:"*", limit:"1" });
  return rows[0] ? rows[0] as unknown as SourceRow : null;
}

async function connectionCredentials(tenantId: string, provider: string): Promise<Record<string, unknown>> {
  const rows = await dbRows("integrations", { tenant_id:`eq.${tenantId}`, provider:`eq.${provider}`, active:"eq.true", select:"credentials", limit:"1" });
  if (!rows[0]) throw new Error(`${provider} is not connected`);
  const raw = (rows[0].credentials ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k,v] of Object.entries(raw)) {
    out[k] = typeof v === "string" && v.startsWith("enc:v1:") ? await decryptSecret(v) : v;
  }
  return out;
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g,"\n")
    .replace(/\u0000/g,"")
    .replace(/[ \t]+\n/g,"\n")
    .replace(/\n{4,}/g,"\n\n\n")
    .trim()
    .slice(0,MAX_TEXT_PER_DOCUMENT);
}
function stripHtml(html: string): string {
  return normalizeText(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi," ")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&#39;/g,"'").replace(/&quot;/g,'"'));
}
function titleFromHtml(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(m?.[1] ?? fallback).slice(0,300) || fallback;
}
function chunkText(text: string, maxChars = 6000, overlap = 500): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < 1000) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const candidates = [clean.lastIndexOf("\n\n", end), clean.lastIndexOf(". ", end), clean.lastIndexOf("\n", end), clean.lastIndexOf(" ", end)];
      const cut = candidates.find((v) => v > start + Math.floor(maxChars * .6));
      if (cut) end = cut + (clean.slice(cut, cut+2)===". " ? 1 : 0);
    }
    const part = clean.slice(start,end).trim();
    if (part) chunks.push(part);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
async function sha256(text: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function makeDoc(externalId:string,title:string,text:string,opts:Partial<IndexedDocument>={}):Promise<IndexedDocument|null>{
  const clean=normalizeText(text); if(!clean) return null;
  const chunks=chunkText(clean).map((content,index)=>({index,content}));
  if(!chunks.length)return null;
  return {externalId,title:title.slice(0,500)||externalId,sourceUrl:opts.sourceUrl,mimeType:opts.mimeType,byteSize:opts.byteSize,metadata:opts.metadata,contentHash:await sha256(clean),chunks};
}

function isPrivateIp(host: string): boolean {
  const h=host.toLowerCase().replace(/^\[|\]$/g,"");
  if (h==="localhost" || h.endsWith(".localhost")) return true;
  if (/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)) return true;
  const m=h.match(/^172\.(\d+)\./); if(m && Number(m[1])>=16 && Number(m[1])<=31)return true;
  if(h==="0.0.0.0"||h==="::"||h==="::1"||h.startsWith("fc")||h.startsWith("fd")||h.startsWith("fe80:"))return true;
  return false;
}
async function assertPublicUrl(urlString:string):Promise<URL>{
  let url:URL; try{url=new URL(urlString)}catch{throw new Error("Invalid URL")}
  if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP(S) URLs are allowed");
  if(url.username||url.password)throw new Error("URLs with embedded credentials are not allowed");
  if(isPrivateIp(url.hostname))throw new Error("Private/internal network URLs are not allowed");
  try {
    const resolved=await Deno.resolveDns(url.hostname,"A");
    if(resolved.some(isPrivateIp))throw new Error("URL resolves to a private/internal network");
  } catch(e) {
    if(e instanceof Error && e.message.includes("private/internal")) throw e;
    // Some edge runtimes restrict DNS APIs; fetch still enforces platform network policy.
  }
  return url;
}
async function readLimitedBytes(r:Response,maxBytes:number):Promise<Uint8Array>{
  const declared=Number(r.headers.get("content-length")??0); if(declared>maxBytes)throw new Error(`Remote content exceeds ${Math.floor(maxBytes/1024/1024)} MB limit`);
  if(!r.body){const b=new Uint8Array(await r.arrayBuffer());if(b.byteLength>maxBytes)throw new Error("Remote content is too large");return b;}
  const reader=r.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("Remote content is too large");}chunks.push(value)}}finally{reader.releaseLock()}
  const out=new Uint8Array(total);let off=0;for(const chunk of chunks){out.set(chunk,off);off+=chunk.byteLength}return out;
}
async function readLimitedText(r:Response,maxBytes=5_242_880):Promise<string>{return new TextDecoder("utf-8",{fatal:false}).decode(await readLimitedBytes(r,maxBytes));}

type RobotsRule={allow:boolean;path:string};
async function loadRobots(root:URL):Promise<RobotsRule[]>{
  try{const u=new URL("/robots.txt",root.origin);const r=await safeFetch(u.toString());if(!r.ok)return[];const text=await readLimitedText(r,512_000);const lines=text.split(/\r?\n/);let applies=false;const rules:RobotsRule[]=[];
    for(const raw of lines){const line=raw.replace(/#.*$/,"").trim();if(!line)continue;const i=line.indexOf(":");if(i<0)continue;const key=line.slice(0,i).trim().toLowerCase();const value=line.slice(i+1).trim();if(key==="user-agent"){const a=value.toLowerCase();applies=a==="*"||a.includes("zochatsourcebot");continue}if(applies&&(key==="allow"||key==="disallow")&&value){rules.push({allow:key==="allow",path:value})}}return rules;
  }catch{return[]}
}
function robotsAllows(url:URL,rules:RobotsRule[]):boolean{if(!rules.length)return true;const path=url.pathname+url.search;let best:RobotsRule|undefined;for(const rule of rules){const pat=rule.path.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\$$/,"$");try{if(new RegExp(`^${pat}`).test(path)&&(!best||rule.path.length>best.path.length))best=rule}catch{/* ignore malformed rule */}}return best?.allow!==false}

async function safeFetch(input:string,init:RequestInit={},maxRedirects=4):Promise<Response>{
  let url=await assertPublicUrl(input);
  for(let i=0;i<=maxRedirects;i++){
    const r=await fetch(url,{...init,redirect:"manual",headers:{"User-Agent":USER_AGENT,Accept:"text/html,application/json,text/plain,*/*;q=0.5",...(init.headers??{})}});
    if([301,302,303,307,308].includes(r.status)){
      if(i===maxRedirects)throw new Error("Too many redirects");
      const loc=r.headers.get("location"); if(!loc)throw new Error("Redirect missing Location");
      url=await assertPublicUrl(new URL(loc,url).toString()); continue;
    }
    return r;
  }
  throw new Error("Fetch failed");
}
function pathMatches(path:string,patterns:string[]):boolean{
  return patterns.some(p=>{const escaped=p.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*"); return new RegExp(`^${escaped}$`,`i`).test(path)});
}
function eligibleUrl(url:URL,origin:string,include:string[],exclude:string[]):boolean{
  if(url.origin!==origin)return false;
  if(["mailto:","tel:","javascript:"].includes(url.protocol))return false;
  const path=url.pathname;
  if(exclude.length&&pathMatches(path,exclude))return false;
  if(include.length&&!pathMatches(path,include))return false;
  return true;
}
function extractLinks(html:string,base:URL):URL[]{
  const out:URL[]=[]; const re=/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>/gi; let m:RegExpExecArray|null;
  while((m=re.exec(html))){try{const u=new URL(m[1],base);u.hash="";out.push(u)}catch{/* ignore */}}
  return out;
}

async function crawlWebsite(source:SourceRow):Promise<IndexedDocument[]>{
  const c=source.config??{}; const root=await assertPublicUrl(String(c.url??""));
  const maxPages=Math.min(500,Math.max(1,Number(c.maxPages??100))); const maxDepth=Math.min(5,Math.max(0,Number(c.maxDepth??2)));
  const include=Array.isArray(c.includePaths)?c.includePaths.map(String):[];
  const exclude=Array.isArray(c.excludePaths)?c.excludePaths.map(String):["/cart*","/checkout*","/account*","/wp-admin*","/login*"];
  const robots=await loadRobots(root);
  const queue:Array<{url:URL;depth:number}>=[{url:root,depth:0}]; const seen=new Set<string>(); const docs:IndexedDocument[]=[];
  while(queue.length&&docs.length<maxPages){
    const item=queue.shift()!; const key=item.url.toString().replace(/\/$/,""); if(seen.has(key))continue;seen.add(key);
    if(!eligibleUrl(item.url,root.origin,include,exclude)||!robotsAllows(item.url,robots))continue;
    try{
      const r=await safeFetch(item.url.toString()); if(!r.ok)continue;
      const ct=(r.headers.get("content-type")??"").toLowerCase(); if(!ct.includes("text/html")&&!ct.includes("text/plain"))continue;
      const html=await readLimitedText(r); const text=ct.includes("html")?stripHtml(html):normalizeText(html);
      const doc=await makeDoc(item.url.toString(),titleFromHtml(html,item.url.pathname||root.hostname),text,{sourceUrl:item.url.toString(),mimeType:ct.split(";")[0],byteSize:new TextEncoder().encode(html).length,metadata:{depth:item.depth}}); if(doc)docs.push(doc);
      if(item.depth<maxDepth&&ct.includes("html")){for(const u of extractLinks(html,item.url)){if(queue.length+seen.size>maxPages*20)break;if(eligibleUrl(u,root.origin,include,exclude)&&robotsAllows(u,robots)&&!seen.has(u.toString().replace(/\/$/,"")))queue.push({url:u,depth:item.depth+1})}}
    }catch{/* failed pages are skipped; source succeeds if at least one indexes */}
  }
  if(!docs.length)throw new Error("No crawlable pages were found");
  return docs;
}
async function fromSingleUrl(source:SourceRow):Promise<IndexedDocument[]>{
  const u=String(source.config.url??""); const r=await safeFetch(u); if(!r.ok)throw new Error(`URL returned ${r.status}`);
  const ct=(r.headers.get("content-type")??"text/plain").toLowerCase(); const body=await readLimitedText(r); const text=ct.includes("html")?stripHtml(body):normalizeText(body);
  const doc=await makeDoc(u,titleFromHtml(body,source.name),text,{sourceUrl:u,mimeType:ct.split(";")[0],byteSize:new TextEncoder().encode(body).length}); return doc?[doc]:[];
}
async function collectSitemapUrls(input:string,limit:number,depth=0,seen=new Set<string>()):Promise<string[]>{
  if(depth>2||seen.has(input)||seen.size>50)return[];seen.add(input);const r=await safeFetch(input);if(!r.ok)throw new Error(`Sitemap returned ${r.status}`);const xml=await readLimitedText(r,5_242_880);
  const locs=[...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,"&").trim()).filter(Boolean);
  if(/<sitemapindex\b/i.test(xml)){const out:string[]=[];for(const child of locs.slice(0,50)){if(out.length>=limit)break;try{out.push(...await collectSitemapUrls(child,limit-out.length,depth+1,seen))}catch{/* skip broken child sitemap */}}return out.slice(0,limit)}
  return locs.slice(0,limit);
}
async function fromSitemap(source:SourceRow):Promise<IndexedDocument[]>{
  const c=source.config??{};const max=Math.min(1000,Math.max(1,Number(c.maxPages??250)));const urls=await collectSitemapUrls(String(c.url??""),max);
  if(!urls.length)throw new Error("No URLs found in sitemap");const docs:IndexedDocument[]=[];
  for(const u of urls){if(docs.length>=MAX_DOCUMENTS_PER_SOURCE)break;try{const rr=await safeFetch(u);if(!rr.ok)continue;const ct=(rr.headers.get("content-type")??"").toLowerCase();if(!ct.includes("text/html")&&!ct.includes("text/plain"))continue;const body=await readLimitedText(rr);const doc=await makeDoc(u,titleFromHtml(body,u),ct.includes("html")?stripHtml(body):body,{sourceUrl:u,mimeType:ct.split(";")[0],byteSize:new TextEncoder().encode(body).length});if(doc)docs.push(doc)}catch{/* skip */}}
  if(!docs.length)throw new Error("No sitemap pages could be indexed");return docs;
}

async function storageBytes(path:string):Promise<{bytes:Uint8Array;contentType:string}>{
  const {root,key}=cfg(); const r=await fetch(`${root}/storage/v1/object/knowledge-sources/${path.split("/").map(encodeURIComponent).join("/")}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
  if(!r.ok)throw new Error(`Uploaded file could not be read (${r.status})`); const buf=await readLimitedBytes(r,52_428_800); return{bytes:buf,contentType:r.headers.get("content-type")??"application/octet-stream"};
}
async function parseFile(name:string,bytes:Uint8Array,mime:string):Promise<string>{
  const ext=name.toLowerCase().split(".").pop()??""; const decode=()=>new TextDecoder("utf-8",{fatal:false}).decode(bytes);
  if(["txt","md","csv","html","htm","json"].includes(ext)||mime.startsWith("text/")){
    const raw=decode(); if(ext==="html"||ext==="htm"||mime.includes("html"))return stripHtml(raw); if(ext==="json"||mime.includes("json")){try{return JSON.stringify(JSON.parse(raw),null,2)}catch{return raw}} return raw;
  }
  if(ext==="pdf"||mime.includes("pdf")){
    const pkg="npm:pdf-parse@1.1.1"; const mod=await import(pkg); const fn=(mod.default??mod) as (b:Uint8Array)=>Promise<{text?:string}>; const out=await fn(bytes); return String(out.text??"");
  }
  if(ext==="docx"||mime.includes("wordprocessingml")){
    const pkg="npm:mammoth@1.8.0"; const mod=await import(pkg); const result=await (mod as any).extractRawText({buffer:bytes}); return String(result.value??"");
  }
  if(ext==="doc"||mime.includes("msword")){
    const pkg="npm:word-extractor@1.0.4"; const mod=await import(pkg); const {Buffer}=await import("node:buffer"); const WordExtractor=(mod as any).default??mod; const extractor=new WordExtractor(); const doc=await extractor.extract(Buffer.from(bytes)); return String(doc?.getBody?.()??"");
  }
  if(ext==="xlsx"||mime.includes("spreadsheetml")){
    const pkg="npm:xlsx@0.18.5"; const XLSX=await import(pkg); const wb=(XLSX as any).read(bytes,{type:"array",cellDates:true}); const pieces:string[]=[]; for(const sheetName of wb.SheetNames){pieces.push(`# ${sheetName}\n`+(XLSX as any).utils.sheet_to_csv(wb.Sheets[sheetName]))} return pieces.join("\n\n");
  }
  if(ext==="pptx"||mime.includes("presentationml")){
    const pkg="npm:jszip@3.10.1"; const JSZipMod=await import(pkg); const JSZip=(JSZipMod as any).default??JSZipMod; const zip=await JSZip.loadAsync(bytes); const names=Object.keys(zip.files).filter((n:string)=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a:string,b:string)=>Number(a.match(/\d+/)?.[0]??0)-Number(b.match(/\d+/)?.[0]??0)); const slides:string[]=[]; for(const n of names){const xml=await zip.files[n].async("text"); const text=[...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m:any)=>m[1].replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")).join(" ");slides.push(`Slide ${slides.length+1}\n${text}`)}return slides.join("\n\n");
  }
  throw new Error(`Unsupported file type .${ext || "unknown"}`);
}
async function fromFile(source:SourceRow):Promise<IndexedDocument[]>{
  if(!source.object_path)throw new Error("Uploaded file is missing"); const {bytes,contentType}=await storageBytes(source.object_path); const fileName=String(source.config.fileName??source.name); const text=await parseFile(fileName,bytes,contentType); const doc=await makeDoc(source.object_path,fileName,text,{mimeType:contentType,byteSize:bytes.byteLength,metadata:{fileName}}); if(!doc)throw new Error("No readable text found in file");return[doc];
}
async function fromText(source:SourceRow):Promise<IndexedDocument[]>{
  const text=String(source.config.content??""); const doc=await makeDoc(source.id,source.name,text,{mimeType:"text/plain"}); if(!doc)throw new Error("Text is empty"); return[doc];
}
async function fromQa(source:SourceRow):Promise<IndexedDocument[]>{
  const pairs=Array.isArray(source.config.pairs)?source.config.pairs as Array<Record<string,unknown>>:[]; const text=pairs.map((p,i)=>`Q${i+1}: ${String(p.question??"")}\nA${i+1}: ${String(p.answer??"")}`).join("\n\n"); const doc=await makeDoc(source.id,source.name,text,{mimeType:"text/qa"});if(!doc)throw new Error("Q&A source is empty");return[doc];
}

async function fromNotion(source:SourceRow):Promise<IndexedDocument[]>{
  const creds=await connectionCredentials(source.tenant_id,"notion"); const token=String(creds.token??creds.api_key??""); if(!token)throw new Error("Notion token missing");
  const headers={Authorization:`Bearer ${token}`,"Notion-Version":"2022-06-28","Content-Type":"application/json"}; const docs:IndexedDocument[]=[]; let cursor:string|undefined; let pages=0;
  do{
    const rr=await fetch("https://api.notion.com/v1/search",{method:"POST",headers,body:JSON.stringify({filter:{property:"object",value:"page"},page_size:100,start_cursor:cursor})});if(!rr.ok)throw new Error(`Notion API ${rr.status}`);const data=await rr.json() as any;
    for(const page of data.results??[]){if(docs.length>=500)break;const titleProp=Object.values(page.properties??{}).find((p:any)=>p?.type==="title") as any;const title=(titleProp?.title??[]).map((x:any)=>x.plain_text??"").join("")||"Notion page";const blocks:string[]=[];let bc:string|undefined;
      do{const br=await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=100${bc?`&start_cursor=${encodeURIComponent(bc)}`:""}`,{headers});if(!br.ok)break;const bd=await br.json() as any;for(const b of bd.results??[]){const payload=(b as any)[b.type];const rich=payload?.rich_text;if(Array.isArray(rich)){const t=rich.map((x:any)=>x.plain_text??"").join("");if(t)blocks.push(t)}}bc=bd.has_more?bd.next_cursor:undefined}while(bc&&blocks.length<2000);
      const doc=await makeDoc(page.id,title,blocks.join("\n"),{sourceUrl:page.url,mimeType:"application/notion-page",metadata:{notionId:page.id}});if(doc)docs.push(doc);
    }
    cursor=data.has_more?data.next_cursor:undefined; pages++;
  }while(cursor&&pages<10&&docs.length<500);
  if(!docs.length)throw new Error("No readable Notion pages found");return docs;
}
async function googleAccessToken(creds:Record<string,unknown>):Promise<string>{
  const token=String(creds.access_token??creds.token??""); const refresh=String(creds.refresh_token??""); const clientId=String(creds.client_id??""); const clientSecret=String(creds.client_secret??"");
  if(refresh&&clientId&&clientSecret){const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:"refresh_token"});const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});if(r.ok){const d=await r.json() as any;if(d.access_token)return String(d.access_token)}}
  if(!token)throw new Error("Google Drive access token missing");return token;
}
async function fromGoogleDrive(source:SourceRow):Promise<IndexedDocument[]>{
  const creds=await connectionCredentials(source.tenant_id,"google_drive"); const token=await googleAccessToken(creds); const headers={Authorization:`Bearer ${token}`}; const folder=String(source.config.folderId??""); const q=["trashed=false",folder?`'${folder.replace(/'/g,"\\'")}' in parents`:""].filter(Boolean).join(" and "); let pageToken="";const docs:IndexedDocument[]=[];
  do{const u=new URL("https://www.googleapis.com/drive/v3/files");u.searchParams.set("q",q);u.searchParams.set("pageSize","100");u.searchParams.set("fields","nextPageToken,files(id,name,mimeType,webViewLink,size,modifiedTime)");if(pageToken)u.searchParams.set("pageToken",pageToken);const lr=await fetch(u,{headers});if(!lr.ok)throw new Error(`Google Drive API ${lr.status}`);const data=await lr.json() as any;
    for(const f of data.files??[]){if(docs.length>=500)break;let endpoint=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`;if(String(f.mimeType).startsWith("application/vnd.google-apps.")){const exports:Record<string,string>={"application/vnd.google-apps.document":"text/plain","application/vnd.google-apps.spreadsheet":"text/csv","application/vnd.google-apps.presentation":"application/vnd.openxmlformats-officedocument.presentationml.presentation"};const target=exports[f.mimeType];if(!target)continue;endpoint=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(target)}`}
      const rr=await fetch(endpoint,{headers});if(!rr.ok)continue;const bytes=await readLimitedBytes(rr,52_428_800);let text="";try{text=await parseFile(f.name,bytes,rr.headers.get("content-type")??f.mimeType)}catch{continue}const doc=await makeDoc(f.id,f.name,text,{sourceUrl:f.webViewLink,mimeType:f.mimeType,byteSize:Number(f.size??bytes.byteLength),metadata:{modifiedTime:f.modifiedTime}});if(doc)docs.push(doc)} pageToken=String(data.nextPageToken??"");
  }while(pageToken&&docs.length<500);if(!docs.length)throw new Error("No readable Google Drive files found");return docs;
}
async function fromDropbox(source:SourceRow):Promise<IndexedDocument[]>{
  const creds=await connectionCredentials(source.tenant_id,"dropbox");const token=String(creds.access_token??creds.token??"");if(!token)throw new Error("Dropbox token missing");const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};const path=String(source.config.path??"");let endpoint="https://api.dropboxapi.com/2/files/list_folder";let body:any={path,recursive:true,limit:200};const entries:any[]=[];
  for(let i=0;i<10;i++){const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body)});if(!r.ok)throw new Error(`Dropbox API ${r.status}`);const d=await r.json() as any;entries.push(...(d.entries??[]).filter((e:any)=>e[".tag"]==="file"));if(!d.has_more)break;endpoint="https://api.dropboxapi.com/2/files/list_folder/continue";body={cursor:d.cursor}}
  const docs:IndexedDocument[]=[];for(const f of entries.slice(0,500)){const r=await fetch("https://content.dropboxapi.com/2/files/download",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Dropbox-API-Arg":JSON.stringify({path:f.path_lower})}});if(!r.ok)continue;const bytes=await readLimitedBytes(r,52_428_800);let text="";try{text=await parseFile(f.name,bytes,r.headers.get("content-type")??"application/octet-stream")}catch{continue}const doc=await makeDoc(f.id,f.name,text,{sourceUrl:`https://www.dropbox.com/home${f.path_display??f.path_lower}`,byteSize:Number(f.size??bytes.byteLength),metadata:{rev:f.rev,modified:f.server_modified}});if(doc)docs.push(doc)}if(!docs.length)throw new Error("No readable Dropbox files found");return docs;
}
async function fromZendesk(source:SourceRow):Promise<IndexedDocument[]>{
  const creds=await connectionCredentials(source.tenant_id,"zendesk");const base=String(creds.base_url??creds.url??"").replace(/\/$/,"");if(!base)throw new Error("Zendesk base URL missing");let auth="";if(creds.token&&creds.email)auth=`Basic ${btoa(`${creds.email}/token:${creds.token}`)}`;else if(creds.access_token)auth=`Bearer ${creds.access_token}`;if(!auth)throw new Error("Zendesk credentials missing");let next=`${base}/api/v2/help_center/articles.json?per_page=100`;const docs:IndexedDocument[]=[];
  for(let p=0;p<10&&next&&docs.length<500;p++){const r=await safeFetch(next,{headers:{Authorization:auth,Accept:"application/json"}});if(!r.ok)throw new Error(`Zendesk API ${r.status}`);const d=await r.json() as any;for(const a of d.articles??[]){const doc=await makeDoc(String(a.id),String(a.title??"Zendesk article"),stripHtml(String(a.body??"")),{sourceUrl:a.html_url,mimeType:"text/html",metadata:{updatedAt:a.updated_at,locale:a.locale}});if(doc)docs.push(doc)}next=String(d.next_page??"")}
  if(!docs.length)throw new Error("No Zendesk Help Center articles found");return docs;
}

async function gather(source:SourceRow):Promise<IndexedDocument[]>{
  switch(source.kind){
    case"file":return fromFile(source);case"website":return crawlWebsite(source);case"sitemap":return fromSitemap(source);case"url":return fromSingleUrl(source);case"text":return fromText(source);case"qa":return fromQa(source);case"notion":return fromNotion(source);case"google_drive":return fromGoogleDrive(source);case"dropbox":return fromDropbox(source);case"zendesk":return fromZendesk(source);default:throw new Error(`Unsupported source type ${source.kind}`);
  }
}
async function replaceIndex(sourceId:string,docs:IndexedDocument[]):Promise<{documentCount:number;chunkCount:number}>{
  const total=docs.reduce((n,d)=>n+d.chunks.reduce((x,c)=>x+c.content.length,0),0);if(total>MAX_TOTAL_TEXT)throw new Error("Source is too large to index in one sync; narrow the source or split it");
  const {root}=cfg(); const payload=docs.slice(0,MAX_DOCUMENTS_PER_SOURCE);const r=await fetch(`${root}/rest/v1/rpc/replace_source_index`,{method:"POST",headers:dbHeaders(),body:JSON.stringify({p_source:sourceId,p_documents:payload})});if(!r.ok)throw new Error(`Index update failed (${r.status}): ${(await r.text()).slice(0,300)}`);const rows=await r.json() as Array<{document_count:number;chunk_count:number}>;return{documentCount:Number(rows[0]?.document_count??0),chunkCount:Number(rows[0]?.chunk_count??0)};
}
export async function syncSource(sourceId:string):Promise<{documentCount:number;chunkCount:number}>{
  const source=await getSource(sourceId);if(!source)throw new Error("Source not found");await dbPatch(`data_sources?id=eq.${sourceId}`,{status:"syncing",last_error:null,updated_at:new Date().toISOString()});
  try{const docs=await gather(source);const result=await replaceIndex(sourceId,docs);return result}catch(e){const message=e instanceof Error?e.message:"Source sync failed";await dbPatch(`data_sources?id=eq.${sourceId}`,{status:"error",last_error:message.slice(0,1000),last_sync_at:new Date().toISOString(),next_sync_at:source.sync_interval_minutes?new Date(Date.now()+Math.max(15,source.sync_interval_minutes)*60000).toISOString():null,updated_at:new Date().toISOString()});throw e}
}
