import React from "react";
import {
  addKnowledge,
  deleteKnowledge,
  listKnowledge,
  updateKnowledge,
  type KnowledgeItem,
} from "../lib/api";
import { Card, Field, Spinner, ErrorBox, toast } from "../components/ui";

export default function KnowledgePage({ tenantId }: { tenantId: string }) {
  const [items, setItems] = React.useState<KnowledgeItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<KnowledgeItem | null>(null);
  const [showNew, setShowNew] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // new-item form
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [keywords, setKeywords] = React.useState("");

  async function load() {
    try {
      const res = await listKnowledge(tenantId);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load knowledge");
    }
  }

  React.useEffect(() => {
    setItems(null);
    setError(null);
    setEditing(null);
    load();
  }, [tenantId]);

  if (error) return <ErrorBox message={error} />;

  async function saveNew() {
    if (!title.trim() || !content.trim()) {
      toast("err", "Title and content are required");
      return;
    }
    setBusy(true);
    try {
      await addKnowledge(tenantId, {
        title: title.trim(),
        content: content.trim(),
        keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setTitle("");
      setContent("");
      setKeywords("");
      setShowNew(false);
      toast("ok", "Knowledge item added");
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await updateKnowledge(tenantId, editing.id, {
        title: editing.title,
        content: editing.content,
        keywords: Array.isArray(editing.keywords) ? editing.keywords : [],
      });
      setEditing(null);
      toast("ok", "Knowledge item updated");
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this knowledge item?")) return;
    setBusy(true);
    try {
      await deleteKnowledge(tenantId, id);
      toast("ok", "Knowledge item deleted");
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  if (items === null && !error) return <Spinner />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Knowledge</h1>
          <p className="desc">FAQs, policies and facts your assistant can answer from.</p>
        </div>
        <button className="btn" onClick={() => setShowNew((s) => !s)}>+ Add item</button>
      </div>

      {showNew && (
        <Card style={{ marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>New knowledge item</h3>
          <Field label="Title">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shipping times" />
          </Field>
          <Field label="Content">
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What the assistant should know…" />
          </Field>
          <Field label="Keywords" hint="Comma-separated, helps matching.">
            <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="shipping, delivery, dispatch" />
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" disabled={busy} onClick={saveNew}>Save</button>
            <button className="btn ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </Card>
      )}

      {items && items.length === 0 && !showNew && (
        <div className="empty">No knowledge yet. Add FAQs or policies to make your assistant smarter.</div>
      )}

      {items?.map((k) =>
        editing?.id === k.id ? (
          <div key={k.id} className="kb-row">
            <div className="field">
              <label>Title</label>
              <input
                type="text"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Content</label>
              <textarea
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Keywords</label>
              <input
                type="text"
                value={(editing.keywords ?? []).join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
            <div className="row-actions">
              <button className="btn sm" disabled={busy} onClick={saveEdit}>Save</button>
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={k.id} className="kb-row">
            <div className="ktitle">{k.title}</div>
            <div className="kcontent">{k.content}</div>
            {k.keywords && k.keywords.length > 0 && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {k.keywords.join(", ")}
              </div>
            )}
            <div className="row-actions">
              <button className="btn secondary sm" onClick={() => setEditing(k)}>Edit</button>
              <button className="btn danger sm" disabled={busy} onClick={() => remove(k.id)}>Delete</button>
            </div>
          </div>
        ),
      )}
    </>
  );
}
