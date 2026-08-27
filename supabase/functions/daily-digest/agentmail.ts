// Deno Edge Function module — NOT part of the Next.js build.
//
// Deliberately small and isolated: this is the ONE file in `daily-digest/`
// that talks to AgentMail, so the endpoint/payload shape below — which is a
// plausible-but-unverified guess, not something confirmed against real
// AgentMail docs — can be corrected later as a single-file change without
// touching `index.ts` or `email-template.ts`.

// TODO: confirm against https://docs.agentmail.to before deploying. This
// endpoint path, auth scheme, and request body shape are a reasonable-looking
// placeholder (REST POST, bearer token, `{ to, subject, html, text }` JSON
// body) — NOT verified against AgentMail's actual API reference. Re-check
// method name, path, header name/scheme, and body field names before this
// function is ever deployed for real.
const AGENTMAIL_ENDPOINT = "https://api.agentmail.to/v0/messages";

/**
 * Sends the daily digest email via AgentMail.
 *
 * `AGENTMAIL_API_KEY` is read from `Deno.env` (a user-set secret via
 * `supabase secrets set`, never hardcoded). Throws on any non-2xx response
 * or network failure; `index.ts` is responsible for deciding what to do
 * with that (currently: surface a 502 and leave `alert_log.emailed_at`
 * untouched, so the same rows are retried on the next scheduled run).
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

  const subject = `Jarvis Daily Digest — ${new Date().toISOString().slice(0, 10)}`;

  const response = await fetch(AGENTMAIL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ to: [to], subject, html, text }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `AgentMail send failed: ${response.status} ${response.statusText} ${bodyText}`,
    );
  }
}
