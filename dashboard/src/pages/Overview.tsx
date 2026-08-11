import React from "react";
import { getOverview, type ConfigData, type OverviewData } from "../lib/api";
import { Card, Spinner, ErrorBox, Badge } from "../components/ui";

export default function Overview({ config }: { config: ConfigData | null }) {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getOverview().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) return <ErrorBox message={error} />;

  const stats = data
    ? [
        { label: "Conversations", value: data.conversations, tone: "text" },
        { label: "Support tickets", value: data.tickets, tone: "text" },
        { label: "Open tickets", value: data.openTickets, tone: "amber" },
        { label: "Chat requests", value: data.usage, tone: "text" },
      ]
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="desc">{config?.tenant ? `Welcome back, ${config.tenant.name}.` : "Your assistant at a glance."}</p>
        </div>
      </div>

      {!data && !error && <Spinner />}

      {stats && (
        <div className="grid cols-4" style={{ marginBottom: 24 }}>
          {stats.map((s) => (
            <Card key={s.label}>
              <div className="stat">
                <div className="value" style={s.tone === "amber" ? { color: "var(--amber)" } : undefined}>
                  {s.value}
                </div>
                <div className="label">{s.label}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Recent conversations</h3>
        {data && data.recentConversations.length === 0 && (
          <div className="empty">No conversations yet. Install the widget and your customers will appear here.</div>
        )}
        {data && data.recentConversations.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Customer</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentConversations.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td>
                    {c.customerEmail ?? <span className="muted">—</span>}
                    {c.emailConsent ? (
                      <span
                        className="muted"
                        style={{ display: "block", fontSize: 11 }}
                        title="Customer consented to store their email (GDPR)"
                      >
                        consent ✓
                      </span>
                    ) : null}
                  </td>
                  <td className="muted">{c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.openTickets > 0 && (
          <div style={{ marginTop: 12 }}>
            <Badge tone="in_progress">{data.openTickets} open ticket(s) need attention</Badge>
          </div>
        )}
      </Card>
    </>
  );
}
