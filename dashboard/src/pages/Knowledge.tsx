import React from "react";
import { addKnowledge, deleteKnowledge, getConfig, listKnowledge, updateKnowledge, type KnowledgeItem } from "../lib/api";
import { Card, Field, Spinner, ErrorBox, toast } from "../components/ui";

export default function KnowledgePage({ tenantId }: { tenantId: string }) {
  const [bots, setBots] = React.useState<Array<{id:string;name:string}>>([]);
  const [chatbotId, setChatbotId] = React.useState("");
  const [items, setItems] = React.useState<KnowledgeItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<KnowledgeItem | null>(null);
  const [showNew, setShowNew] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [keywords, setKeywords] = React.useState("");

  async function loadConfig() {
    const cfg = await getConfig(tenantId);
    const rows = cfg.chatbots.map((b) => ({id:b.id,name:b.name}));
    setBots(rows);
    const next = rows.some((b) => b.id === chatbotId) ? chatbotId : rows[0]?.id ?? "";
    setChatbotId(next);
    return next;
  }
  async function load(id = chatbotId) {
    if (!id) { setItems([]); return; }
    try { setItems((await listKnowledge(tenantId, id)).items); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load knowledge"); }
  }
  React.useEffect(() => {
    setItems(null); setError(null); setEditing(null);
    loadConfig().then((id) => load(id)).catch((e)=>setError(e instanceof Error ? e.message : "Failed to load"));
  }, [tenantId]);
  React.useEffect(() => { if (chatbotId) { setItems(null); load(chatbotId); } }, [chatbotId]);

  if (error) return <ErrorBox message={error} />;
  if (items === null) return <Spinner />;

  async function saveNew() {
    if (!chatbotId || !title.trim() || !content.trim()) return toast("err", "Assistant, title and content are required");
    setBusy(true);
    try {
      await addKnowledge(tenantId, { chatbotId, title:title.trim(), content:content.trim(), keywords:keywords.split(",").map(s=>s.trim()).filter(Boolean) });
      setTitle(""); setContent(""); setKeywords(""); setShowNew(false); await load(chatbotId); toast("ok", "Knowledge item added");
    } catch(e) { toast("err", e instanceof Error ? e.message : "Failed to add"); } finally { setBusy(false); }
  }
  async function saveEdit() {
    if (!editing) return; setBusy(true);
    try { await updateKnowledge(tenantId, editing.id, {title:editing.title,content:editing.content,keywords:Array.isArray(editing.keywords)?editing.keywords:[]}); setEditing(null); await load(chatbotId); toast("ok","Knowledge updated"); }
    catch(e){ toast("err",e instanceof Error?e.message:"Failed to update"); } finally {setBusy(false);}
  }
  async function remove(id:string){ if(!confirm("Delete this knowledge item?"))return; setBusy(true); try{await deleteKnowledge(tenantId,id);await load(chatbotId);toast("ok","Knowledge item deleted");}catch(e){toast("err",e instanceof Error?e.message:"Delete failed");}finally{setBusy(false);} }

  const selectedName=bots.find(b=>b.id===chatbotId)?.name ?? "assistant";
  return <>
    <div className="page-head"><div><h1>Knowledge</h1><p className="desc">Knowledge is isolated per AI assistant.</p></div><button className="btn" onClick={()=>setShowNew(v=>!v)}>+ Add item</button></div>
    <Card style={{marginBottom:18}}><Field label="AI assistant" hint="Only the selected assistant can use these knowledge items."><select value={chatbotId} onChange={e=>setChatbotId(e.target.value)}>{bots.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field></Card>
    {showNew&&<Card style={{marginBottom:18}}><h3 style={{marginTop:0}}>New knowledge for {selectedName}</h3><Field label="Title"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label="Content"><textarea value={content} onChange={e=>setContent(e.target.value)}/></Field><Field label="Keywords"><input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="comma, separated"/></Field><button className="btn" disabled={busy} onClick={saveNew}>Add knowledge</button></Card>}
    {items.length===0?<Card><div className="muted">No knowledge has been added to {selectedName} yet.</div></Card>:items.map(item=><Card key={item.id} style={{marginBottom:12}}>
      {editing?.id===item.id?<><Field label="Title"><input value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/></Field><Field label="Content"><textarea value={editing.content} onChange={e=>setEditing({...editing,content:e.target.value})}/></Field><Field label="Keywords"><input value={(editing.keywords??[]).join(", ")} onChange={e=>setEditing({...editing,keywords:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})}/></Field><div style={{display:"flex",gap:8}}><button className="btn" disabled={busy} onClick={saveEdit}>Save</button><button className="btn secondary" onClick={()=>setEditing(null)}>Cancel</button></div></>:<><h3 style={{margin:"0 0 8px"}}>{item.title}</h3><p style={{whiteSpace:"pre-wrap"}}>{item.content}</p><div style={{display:"flex",gap:8}}><button className="btn secondary sm" onClick={()=>setEditing(item)}>Edit</button><button className="btn secondary sm" onClick={()=>remove(item.id)}>Delete</button></div></>}
    </Card>)}
  </>;
}
