// Email delivery for support tickets (convo2 §"email the tenant").
//
// Design rule: email is SEPARATE from ticket creation. The ticket is written
// to the DB first (that's the source of truth); this module is best-effort
// delivery. If the email fails (no RESEND_API_KEY, Resend down, etc.) the
// ticket still exists — the tenant can still see it in their dashboard.
//
// The recipient is ALWAYS the tenant's support_email (resolved server-side).
// The AI can never influence where this email goes.
import { env } from "./env.ts";
import type { Tenant, Ticket } from "./types.ts";

export interface TicketEmailResult {
  sent: boolean;
  provider: "resend" | "none";
  error?: string;
  to?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

function resendConfig(): { apiKey: string; from: string } | null {
  const apiKey = env("RESEND_API_KEY");
  const from = env("RESEND_FROM");
  if (!apiKey) return null;
  return { apiKey, from: from || "support@mail.example.com" };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ticketEmailHtml(t: Ticket, tenant: Tenant): string {
  const categoryLabel =
    t.category
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "Other";
  const statusColour = t.status === "resolved" ? "#16a34a" : t.status === "closed" ? "#64748b" : "#9c7b4f";
  const rows = [
    ["Reference", t.reference],
    ["From", `${t.customerName || "A customer"} <${escapeHtml(t.customerEmail)}>`],
    ["Category", categoryLabel],
    ["Priority", t.priority.charAt(0).toUpperCase() + t.priority.slice(1)],
    ["Status", t.status.charAt(0).toUpperCase() + t.status.slice(1)],
    ["Raised", new Date(t.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap;font-weight:600;">${k}</td>` +
        `<td style="padding:6px 0;vertical-align:top;">${v}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:${tenant.brandColour || "#9c7b4f"};padding:20px 24px;">
            <div style="color:#ffffff;font-size:18px;font-weight:700;">New support ticket</div>
            <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:2px;">${escapeHtml(tenant.name)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td style="font-size:22px;font-weight:800;color:#18181b;">${escapeHtml(t.reference)}</td>
                <td style="padding-left:12px;">
                  <span style="display:inline-block;background:${statusColour};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 10px;border-radius:999px;">${escapeHtml(t.status)}</span>
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#27272a;">
              ${rows}
            </table>
            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e4e4e7;">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#71717a;margin-bottom:6px;">Subject</div>
              <div style="font-size:15px;font-weight:600;color:#18181b;margin-bottom:14px;">${escapeHtml(t.subject)}</div>
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#71717a;margin-bottom:6px;">Issue</div>
              <div style="font-size:14px;line-height:1.55;color:#3f3f46;white-space:pre-wrap;">${escapeHtml(t.description)}</div>
            </div>
            <div style="margin-top:22px;">
              <a href="https://app.supabase.com/project/_/sql" target="_blank"
                 style="display:inline-block;background:#18181b;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px;">View ticket</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 24px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:11px;color:#a1a1aa;">
            Sent automatically by the ${escapeHtml(tenant.name)} assistant. Please do not reply to this email.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send a "new support ticket" email to the tenant (via Resend).
 * Never throws — returns a result object so the caller can decide what to log.
 * Called AFTER the ticket is persisted, so a failure here can't lose the ticket.
 */
export async function sendTicketEmail(tenant: Tenant, ticket: Ticket): Promise<TicketEmailResult> {
  const cfg = resendConfig();
  if (!cfg) {
    return { sent: false, provider: "none", error: "RESEND_API_KEY not configured — email skipped (ticket still saved)." };
  }
  const to = tenant.supportEmail;
  if (!to) {
    return { sent: false, provider: "resend", error: `Tenant ${tenant.slug} has no support_email — email skipped.` };
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [to],
        subject: `New support ticket — ${ticket.reference}`,
        html: ticketEmailHtml(ticket, tenant),
        text: [
          `New support ticket ${ticket.reference}`,
          "",
          `From: ${ticket.customerName || "A customer"} <${ticket.customerEmail}>`,
          `Category: ${ticket.category}  Priority: ${ticket.priority}`,
          `Subject: ${ticket.subject}`,
          "",
          ticket.description,
        ].join("\n"),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { sent: false, provider: "resend", error: `Resend ${res.status}: ${body.slice(0, 300)}`, to };
    }
    return { sent: true, provider: "resend", to };
  } catch (err) {
    return {
      sent: false,
      provider: "resend",
      error: err instanceof Error ? err.message : "Unknown email error",
      to,
    };
  }
}
