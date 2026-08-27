// Deno Edge Function module — NOT part of the Next.js build.
//
// Deliberately small and isolated: this is the ONE file in `daily-digest/`
// that talks to AgentMail, so the endpoint/payload shape can be corrected
// as a single-file change without touching `index.ts` or `email-template.ts`.
//
// Endpoint/payload confirmed against AgentMail's real API reference
// (https://docs.agentmail.to/api-reference/inboxes/messages/send.md):
// POST /v0/inboxes/{inbox_id}/messages/send, bearer auth, JSON body with
// `to`/`subject`/`text`/`html` — the sending inbox is a PATH parameter, not
// a body field, which the original placeholder guess got wrong (it posted
// to `/v0/messages` with no inbox reference at all).

const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

/**
 * Sends the daily digest email via AgentMail.
 *
 * `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX_ID` are read from `Deno.env`
 * (user-set secrets via `supabase secrets set`, never hardcoded).
 * `AGENTMAIL_INBOX_ID` is the sending inbox's address (e.g.
 * `harsh_assistant@agentmail.to`) — AgentMail addresses inboxes by their
 * email address in the API path. Throws on any non-2xx response or network
 * failure; `index.ts` is responsible for deciding what to do with that
 * (currently: surface a 502 and leave `alert_log.emailed_at` untouched, so
 * the same rows are retried on the next scheduled run).
 */
export async function sendDigestEmail(
  html: string,
  text: string,
  to: string,
): Promise<void> {
  const apiKey = Deno.env.get("AGENTMAIL_API_KEY");
  if (!apiKey) {
    throw new Error("AGENTMAIL_API_KEY environment variable is not set");
  }
  const inboxId = Deno.env.get("AGENTMAIL_INBOX_ID");
  if (!inboxId) {
    throw new Error("AGENTMAIL_INBOX_ID environment variable is not set");
  }

  const subject = `Jarvis Daily Digest — ${new Date().toISOString().slice(0, 10)}`;

  const response = await fetch(
    `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to, subject, html, text }),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `AgentMail send failed: ${response.status} ${response.statusText} ${bodyText}`,
    );
  }
}
