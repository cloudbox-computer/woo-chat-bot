import React from "react";
import { listTickets, updateTicket, type TicketItem } from "../lib/api";
import { Card, Spinner, ErrorBox, Badge, toast } from "../components/ui";

const STATUSES = ["open", "in_progress", "resolved", "closed"];

function statusTone(s: string) {
  return s === "open" ? "open" : s === "in_progress" ? "in_progress" : s === "resolved" ? "resolved" : "closed";
}

export default function TicketsPage() {
  const [items, setItems] = React.useState<TicketItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState("all");

  async function load() {
    try {
      const res = await listTickets();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    setBusy(true);
    try {
      await updateTicket(id, { status });
      toast("ok", `Ticket marked ${status}`);
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} />;
  if (items === null) return <Spinner />;

  const filtered =
    filter === "all" ? items : filter === "open" ? items.filter((t) => t.status === "open" || t.status === "in_progress") : items.filter((t) => t.status === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Support tickets</h1>
          <p className="desc">Tickets created by customers through the widget.</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["all", "open", "resolved", "closed"].map((f) => (
          <button key={f} className={`btn ${filter === f ? "" : "secondary"} sm`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {items.length === 0 && <div className="empty">No tickets yet. When a customer asks for help, a ticket appears here.</div>}

      {filtered.length > 0 && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Subject</th>
                <th>Customer</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{t.reference}</td>
                  <td>
                    <div>{t.subject}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{t.category}</div>
                  </td>
                  <td>
                    <div>{t.customer_name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{t.customer_email}</div>
                  </td>
                  <td><Badge tone={t.priority}>{t.priority}</Badge></td>
                  <td><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                  <td>
                    <select
                      value={t.status}
                      disabled={busy}
                      onChange={(e) => setStatus(t.id, e.target.value)}
                      style={{ width: "auto" }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
