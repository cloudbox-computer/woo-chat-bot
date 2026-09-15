import React from "react";
import { supabase } from "../lib/supabase";
import {
  createDataSource, deleteDataSource, getConfig, listDataSources, listSourceDocuments,
  syncDataSource, updateDataSource, type DataSourceItem, type DataSourceKind, type SourceDocumentItem,
} from "../lib/api";
import { Card, Field, Spinner, ErrorBox, Badge, toast } from "../components/ui";

const SOURCE_TYPES: Array<{kind:DataSourceKind;name:string;desc:string;icon:string}> = [
  {kind:"file",name:"Files",desc:"PDF, DOC, DOCX, TXT, MD, CSV, XLSX, PPTX, HTML and JSON",icon:"file"},
  {kind:"website",name:"Website",desc:"Crawl a site with include/exclude paths and depth limits",icon:"globe"},
  {kind:"sitemap",name:"Sitemap",desc:"Index URLs from an XML sitemap",icon:"sitemap"},
  {kind:"url",name:"Single URL",desc:"Index one public page",icon:"link"},
  {kind:"text",name:"Text",desc:"Paste authoritative text or internal guidance",icon:"text"},
  {kind:"qa",name:"Q&A",desc:"Maintain structured questions and answers",icon:"chat"},
  {kind:"notion",name:"Notion",desc:"Sync pages from your connected Notion workspace",icon:"notion"},
  {kind:"google_drive",name:"Google Drive",desc:"Sync supported files from Drive or a folder",icon:"drive"},
  {kind:"dropbox",name:"Dropbox",desc:"Sync supported files from a Dropbox path",icon:"dropbox"},
  {kind:"zendesk",name:"Zendesk",desc:"Sync Help Center articles",icon:"zendesk"},
  {kind:"wordpress",name:"WordPress",desc:"Sync published pages and posts",icon:"wordpress"},
];
const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx,.html,.htm,.json";

function SourceTypeIcon({ icon }: { icon: string }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (icon) {
    case "globe": return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>;
    case "sitemap": return <svg {...common}><path d="M12 4v5M6 20v-5h12v5M6 15v-3h12v3"/><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="3" y="18" width="6" height="4" rx="1"/><rect x="15" y="18" width="6" height="4" rx="1"/></svg>;
    case "link": return <svg {...common}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>;
    case "text": return <svg {...common}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></svg>;
    case "chat": return <svg {...common}><path d="M21 11.5a8 8 0 0 1-8.5 8L7 22v-3.4A8 8 0 1 1 21 11.5Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg>;
    case "notion": return <span className="source-brand-glyph notion">N</span>;
    case "drive": return <span className="source-brand-glyph drive">△</span>;
    case "dropbox": return <span className="source-brand-glyph dropbox">◆</span>;
    case "zendesk": return <span className="source-brand-glyph zendesk">Z</span>;
    case "wordpress": return <span className="source-brand-glyph wordpress">W</span>;
    default: return <svg {...common}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/></svg>;
  }
}

function statusBadge(status:string){
  const tone=status==="ready"?"ok":status==="error"?"danger":status==="syncing"||status==="pending"?"warn":undefined;
  return <Badge tone={tone as any}>{status}</Badge>;
}
function ago(v?:string|null){if(!v)return "Never";const d=new Date(v);if(Number.isNaN(d.getTime()))return "Never";return d.toLocaleString();}

export default function KnowledgePage({ tenantId }: { tenantId: string }) {
  const [bots,setBots]=React.useState<Array<{id:string;name:string}>>([]);
  const [chatbotId,setChatbotId]=React.useState("");
  const [items,setItems]=React.useState<DataSourceItem[]|null>(null);
  const [error,setError]=React.useState<string|null>(null);
  const [showAdd,setShowAdd]=React.useState(false);
  const [kind,setKind]=React.useState<DataSourceKind>("file");
  const [name,setName]=React.useState("");
  const [busy,setBusy]=React.useState(false);
  const [file,setFile]=React.useState<File|null>(null);
  const [url,setUrl]=React.useState("");
  const [text,setText]=React.useState("");
  const [includePaths,setIncludePaths]=React.useState("");
  const [excludePaths,setExcludePaths]=React.useState("/cart*\n/checkout*\n/account*\n/wp-admin*\n/login*");
  const [maxPages,setMaxPages]=React.useState(100);
  const [maxDepth,setMaxDepth]=React.useState(2);
  const [folderId,setFolderId]=React.useState("");
  const [dropboxPath,setDropboxPath]=React.useState("");
  const [qaPairs,setQaPairs]=React.useState<Array<{question:string;answer:string}>>([{question:"",answer:""}]);
  const [syncMinutes,setSyncMinutes]=React.useState<number|null>(1440);
  const [docs,setDocs]=React.useState<{source:DataSourceItem;items:SourceDocumentItem[]}|null>(null);

  async function loadConfig(){const cfg=await getConfig(tenantId);const rows=cfg.chatbots.map(b=>({id:b.id,name:b.name}));setBots(rows);const next=rows.some(b=>b.id===chatbotId)?chatbotId:rows[0]?.id??"";setChatbotId(next);return next;}
  async function load(id=chatbotId){if(!id){setItems([]);return;}try{setItems((await listDataSources(tenantId,id)).items);setError(null)}catch(e){setError(e instanceof Error?e.message:"Failed to load data sources")}}
  React.useEffect(()=>{setItems(null);setError(null);loadConfig().then(load).catch(e=>setError(e instanceof Error?e.message:"Failed to load"))},[tenantId]);
  React.useEffect(()=>{if(chatbotId){setItems(null);void load(chatbotId)}},[chatbotId]);

  function resetForm(){setKind("file");setName("");setFile(null);setUrl("");setText("");setIncludePaths("");setExcludePaths("/cart*\n/checkout*\n/account*\n/wp-admin*\n/login*");setMaxPages(100);setMaxDepth(2);setFolderId("");setDropboxPath("");setQaPairs([{question:"",answer:""}]);setSyncMinutes(1440)}
  function defaultName(){if(name.trim())return name.trim();if(kind==="file")return file?.name||"Uploaded file";if(["website","sitemap","url"].includes(kind)){try{return new URL(url).hostname}catch{return SOURCE_TYPES.find(x=>x.kind===kind)?.name||"Source"}}return SOURCE_TYPES.find(x=>x.kind===kind)?.name||"Source"}
  function configForKind():Record<string,unknown>{
    if(kind==="file")return{fileName:file?.name,mimeType:file?.type,size:file?.size};
    if(kind==="website")return{url,maxPages,maxDepth,includePaths:includePaths.split(/\n|,/).map(x=>x.trim()).filter(Boolean),excludePaths:excludePaths.split(/\n|,/).map(x=>x.trim()).filter(Boolean)};
    if(kind==="sitemap")return{url,maxPages}; if(kind==="url")return{url}; if(kind==="text")return{content:text};
    if(kind==="qa")return{pairs:qaPairs.filter(p=>p.question.trim()&&p.answer.trim())}; if(kind==="google_drive")return{folderId:folderId.trim()}; if(kind==="dropbox")return{path:dropboxPath.trim()};
    return{};
  }
  async function create(){
    if(!chatbotId)return toast("err","Select an assistant"); if(kind==="file"&&!file)return toast("err","Choose a file first");
    if(file&&file.size>50*1024*1024)return toast("err","Files are limited to 50 MB");
    setBusy(true);let createdId="";
    try{
      const res=await createDataSource(tenantId,{chatbotId,kind,name:defaultName(),config:configForKind(),syncIntervalMinutes:["text","qa"].includes(kind)?null:syncMinutes});createdId=res.item.id;
      if(kind==="file"){
        if(!res.uploadPath||!file)throw new Error("Upload path was not created");
        const up=await supabase.storage.from("knowledge-sources").upload(res.uploadPath,file,{upsert:false,contentType:file.type||undefined,cacheControl:"3600"});
        if(up.error)throw new Error(up.error.message);
        await syncDataSource(tenantId,res.item.id);
      }
      setShowAdd(false);resetForm();await load(chatbotId);toast("ok","Data source added. Indexing has started.");
    }catch(e){if(createdId&&kind==="file"){try{await deleteDataSource(tenantId,createdId)}catch{/* best effort cleanup */}}toast("err",e instanceof Error?e.message:"Failed to add source")}
    finally{setBusy(false)}
  }
  async function sync(item:DataSourceItem){setBusy(true);try{await syncDataSource(tenantId,item.id);await load(chatbotId);toast("ok","Sync queued")}catch(e){toast("err",e instanceof Error?e.message:"Sync failed")}finally{setBusy(false)}}
  async function pause(item:DataSourceItem){setBusy(true);try{await updateDataSource(tenantId,item.id,{paused:item.status!=="paused"});await load(chatbotId);toast("ok",item.status==="paused"?"Source resumed":"Source paused")}catch(e){toast("err",e instanceof Error?e.message:"Update failed")}finally{setBusy(false)}}
  async function remove(item:DataSourceItem){if(!confirm(`Delete “${item.name}” and its indexed knowledge?`))return;setBusy(true);try{await deleteDataSource(tenantId,item.id);await load(chatbotId);toast("ok","Source deleted")}catch(e){toast("err",e instanceof Error?e.message:"Delete failed")}finally{setBusy(false)}}
  async function openDocs(item:DataSourceItem){try{setDocs({source:item,items:(await listSourceDocuments(tenantId,item.id)).items})}catch(e){toast("err",e instanceof Error?e.message:"Could not load indexed documents")}}

  if(error)return <ErrorBox message={error}/>; if(items===null)return <Spinner/>;
  return <div className="page data-sources-page">
    <div className="page-head"><div><h1>Knowledge</h1><p className="desc">Teach ZoChat the information you want it to use when helping customers.</p></div><button className="btn primary" onClick={()=>setShowAdd(true)}>+ Add knowledge</button></div>
    <Card style={{marginBottom:18}}><Field label="Which assistant?" hint="Choose the assistant that should learn from this information."><select value={chatbotId} onChange={e=>setChatbotId(e.target.value)}>{bots.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field></Card>
    <div className="source-summary-grid">
      <Card><div className="kpi-label">Sources</div><div className="kpi-value">{items.length}</div></Card>
      <Card><div className="kpi-label">Documents</div><div className="kpi-value">{items.reduce((n,x)=>n+(x.document_count||0),0)}</div></Card>
      <Card><div className="kpi-label">Indexed chunks</div><div className="kpi-value">{items.reduce((n,x)=>n+(x.chunk_count||0),0)}</div></Card>
      <Card><div className="kpi-label">Needs attention</div><div className="kpi-value">{items.filter(x=>x.status==="error").length}</div></Card>
    </div>
    {items.length===0?<Card><div className="empty-state"><h3>No data sources yet</h3><p className="muted">Add files, websites, remote documents or Q&A so this assistant has grounded business knowledge.</p><button className="btn primary" onClick={()=>setShowAdd(true)}>Add your first source</button></div></Card>:<div className="source-list">{items.map(item=><Card key={item.id} className="source-card"><div className="source-card-main"><div className="source-icon">{SOURCE_TYPES.find(x=>x.kind===item.kind)?.name.slice(0,1)??"D"}</div><div className="source-info"><div className="source-title-row"><h3>{item.name}</h3>{statusBadge(item.status)}</div><div className="source-meta"><span>{SOURCE_TYPES.find(x=>x.kind===item.kind)?.name??item.kind}</span><span>{item.document_count||0} docs</span><span>{item.chunk_count||0} chunks</span><span>Last sync: {ago(item.last_sync_at)}</span></div>{item.last_error&&<div className="source-error">{item.last_error}</div>}</div></div><div className="source-actions"><button className="btn secondary sm" disabled={busy||item.status==="syncing"} onClick={()=>sync(item)}>Sync now</button><button className="btn secondary sm" onClick={()=>openDocs(item)}>Documents</button><button className="btn secondary sm" disabled={busy} onClick={()=>pause(item)}>{item.status==="paused"?"Resume":"Pause"}</button><button className="btn secondary sm danger-btn" disabled={busy} onClick={()=>remove(item)}>Delete</button></div></Card>)}</div>}

    {showAdd&&<div className="modal-overlay source-modal-overlay" onClick={()=>!busy&&setShowAdd(false)}><div className="modal source-modal" onClick={e=>e.stopPropagation()}><div className="modal-head source-modal-head"><div className="source-modal-title"><div className="source-modal-title-icon"><SourceTypeIcon icon="file"/></div><div><h2>Add knowledge</h2><p className="desc">Where should ZoChat learn this information from?</p></div></div><button className="icon-button source-modal-close" aria-label="Close" disabled={busy} onClick={()=>setShowAdd(false)}>×</button></div>
      <div className="source-type-grid">{SOURCE_TYPES.map(t=><button key={t.kind} type="button" className={`source-type ${kind===t.kind?"selected":""}`} onClick={()=>setKind(t.kind)}><span className="source-type-icon"><SourceTypeIcon icon={t.icon}/></span><span className="source-type-copy"><strong>{t.name}</strong><small>{t.desc}</small></span>{kind===t.kind&&<span className="source-type-check">✓</span>}</button>)}</div>
      <div className="source-form-divider"/>
      <Field label="Name this knowledge" hint="Optional — we can create a sensible name for you."><div className="input-with-icon"><span className="input-leading-icon"><SourceTypeIcon icon={SOURCE_TYPES.find(x=>x.kind===kind)?.icon||"file"}/></span><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Customer support handbook"/></div></Field>
      {kind==="file"&&<Field label="Choose file"><label className={`file-drop-zone ${file?"has-file":""}`}><input className="file-native-input" type="file" accept={ACCEPT} onChange={e=>setFile(e.target.files?.[0]??null)}/><span className="file-upload-icon">↑</span><span className="file-drop-copy">{file?<><strong>{file.name}</strong><small>{(file.size/1024/1024).toFixed(2)} MB · Click to replace</small></>:<><span>Drag and drop a file here, or <strong>click to browse</strong></span><small>Maximum 50 MB. Supported: PDF, DOC, DOCX, TXT, MD, CSV, XLSX, PPTX, HTML, JSON.</small></>}</span></label></Field>}
      {(["website","sitemap","url"] as DataSourceKind[]).includes(kind)&&<Field label={kind==="website"?"Website URL":kind==="sitemap"?"Sitemap URL":"Page URL"}><input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder={kind==="sitemap"?"https://example.com/sitemap.xml":"https://example.com"}/></Field>}
      {kind==="website"&&<><div className="form-grid-2"><Field label="Page limit"><input type="number" min={1} max={500} value={maxPages} onChange={e=>setMaxPages(Number(e.target.value))}/></Field><Field label="How many links deep?"><input type="number" min={0} max={5} value={maxDepth} onChange={e=>setMaxDepth(Number(e.target.value))}/></Field></div><div className="form-grid-2"><Field label="Only include these website sections" hint="Optional, one pattern per line. * wildcard supported."><textarea value={includePaths} onChange={e=>setIncludePaths(e.target.value)} placeholder="/help/*"/></Field><Field label="Ignore these website sections"><textarea value={excludePaths} onChange={e=>setExcludePaths(e.target.value)}/></Field></div></>}
      {kind==="sitemap"&&<Field label="Page limit"><input type="number" min={1} max={1000} value={maxPages} onChange={e=>setMaxPages(Number(e.target.value))}/></Field>}
      {kind==="text"&&<Field label="Content"><textarea rows={10} value={text} onChange={e=>setText(e.target.value)} placeholder="Paste trusted information here…"/></Field>}
      {kind==="qa"&&<div className="qa-editor"><label>Questions & answers</label>{qaPairs.map((p,i)=><Card key={i} className="qa-row"><Field label={`Question ${i+1}`}><input value={p.question} onChange={e=>setQaPairs(v=>v.map((x,j)=>j===i?{...x,question:e.target.value}:x))}/></Field><Field label="Answer"><textarea value={p.answer} onChange={e=>setQaPairs(v=>v.map((x,j)=>j===i?{...x,answer:e.target.value}:x))}/></Field>{qaPairs.length>1&&<button className="btn secondary sm" onClick={()=>setQaPairs(v=>v.filter((_,j)=>j!==i))}>Remove</button>}</Card>)}<button className="btn secondary sm" onClick={()=>setQaPairs(v=>[...v,{question:"",answer:""}])}>+ Add Q&A</button></div>}
      {kind==="google_drive"&&<Field label="Folder ID" hint="Optional. Leave blank to index accessible Drive files."><input value={folderId} onChange={e=>setFolderId(e.target.value)} placeholder="Google Drive folder ID"/></Field>}
      {kind==="dropbox"&&<Field label="Dropbox path" hint="Leave blank for the connected app root."><input value={dropboxPath} onChange={e=>setDropboxPath(e.target.value)} placeholder="/Support"/></Field>}
      {["notion","google_drive","dropbox","zendesk","wordpress"].includes(kind)&&<div className="info-banner">This source uses the matching connection in <button className="link-button" onClick={()=>{const u=new URL(window.location.href);u.searchParams.set("page","integrations");window.history.pushState({},"",u);window.dispatchEvent(new PopStateEvent("popstate"));}}>Integrations</button>.</div>}
      {!(["text","qa"].includes(kind))&&<Field label="Automatic refresh"><select value={syncMinutes??""} onChange={e=>setSyncMinutes(e.target.value?Number(e.target.value):null)}><option value="">Manual only</option><option value={60}>Every hour</option><option value={360}>Every 6 hours</option><option value={1440}>Every 24 hours</option><option value={10080}>Every 7 days</option></select></Field>}
      <div className="modal-actions"><button className="btn secondary" disabled={busy} onClick={()=>setShowAdd(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={create}>{busy?"Adding…":"Add source"}</button></div>
    </div></div>}

    {docs&&<div className="modal-overlay" onClick={()=>setDocs(null)}><div className="modal source-docs-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><h2>{docs.source.name}</h2><p className="desc">Indexed documents</p></div><button className="icon-button" onClick={()=>setDocs(null)}>×</button></div>{docs.items.length===0?<div className="muted">No indexed documents yet.</div>:<div className="document-list">{docs.items.map(d=><div className="document-row" key={d.id}><div><strong>{d.title}</strong><div className="muted">{d.mime_type||"Document"}{d.byte_size?` · ${(Number(d.byte_size)/1024).toFixed(1)} KB`:""}</div></div>{d.source_url&&<a className="btn secondary sm" href={d.source_url} target="_blank" rel="noreferrer">Open</a>}</div>)}</div>}</div></div>}
  </div>;
}
