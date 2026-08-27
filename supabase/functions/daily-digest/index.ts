// Deno Edge Function — NOT part of the Next.js build/lint/test pipeline.
// Written in Task 11 but NOT deployed and NOT wired to a real `pg_cron`
// schedule yet — that happens later with the user against the real
// Supabase project.

import { createAdminClient } from "../_shared/supabase-client.ts";
import {
  groupAlertsByStock,
  renderDigestHtml,
  renderDigestText,
} from "./email-template.ts";
import { sendDigestEmail } from "./agentmail.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (_req: Request) => {
  const supabase = createAdminClient();

  const { data: alertRows, error: alertError } = await supabase
    .from("alert_log")
    .select("id, stock_id, trigger_type, triggered_at, details")
    .is("emailed_at", null)
    .order("triggered_at", { ascending: true });

  if (alertError) {
    return jsonResponse({ error: alertError.message }, 500);
  }

  if (!alertRows || alertRows.length === 0) {
    return jsonResponse({ sent: false, reason: "no unemailed alerts" }, 200);
  }

  const stockIds = [...new Set(alertRows.map((r) => r.stock_id as string))];

  const { data: stockRows, error: stocksError } = await supabase
    .from("stocks")
    .select("id, ticker")
    .in("id", stockIds);

  if (stocksError) {
    return jsonResponse({ error: stocksError.message }, 500);
  }

  const tickerByStockId = new Map<string, string>(
    (stockRows ?? []).map((s: { id: string; ticker: string }) => [
      s.id,
      s.ticker,
    ]),
  );

  const enrichedRows = alertRows.map((row) => ({
    stock_id: row.stock_id as string,
    ticker: tickerByStockId.get(row.stock_id as string) ?? "UNKNOWN",
    trigger_type: row.trigger_type as string,
    triggered_at: row.triggered_at as string,
    details: row.details,
  }));

  const groups = groupAlertsByStock(enrichedRows);
  const html = renderDigestHtml(groups);
  const text = renderDigestText(groups);

  const to = Deno.env.get("DIGEST_RECIPIENT_EMAIL");
  if (!to) {
    return jsonResponse(
      { error: "DIGEST_RECIPIENT_EMAIL environment variable is not set" },
      500,
    );
  }

  try {
    await sendDigestEmail(html, text, to);
  } catch (err) {
    console.error("daily-digest: sendDigestEmail failed", err);
    return jsonResponse(
      {
        error: `Failed to send digest email: ${err instanceof Error ? err.message : String(err)}`,
      },
      502,
    );
  }

  // Only mark rows emailed AFTER a confirmed successful send — if the send
  // failed above, we return before reaching here and every row stays
  // `emailed_at is null`, so the next scheduled run retries them (rather
  // than silently dropping alerts on a transient AgentMail failure).
  const alertLogIds = alertRows.map((r) => r.id);
  const { error: updateError } = await supabase
    .from("alert_log")
    .update({ emailed_at: new Date().toISOString() })
    .in("id", alertLogIds);

  if (updateError) {
    // The email already went out at this point; failing to mark rows
    // emailed means the next run may re-send the same alerts. Surface it
    // loudly rather than silently swallowing it.
    console.error(
      "daily-digest: email sent but failed to mark alert_log rows emailed",
      updateError,
    );
    return jsonResponse(
      {
        error: `Email sent but failed to mark alert_log rows emailed: ${updateError.message}`,
      },
      500,
    );
  }

  return jsonResponse(
    { sent: true, alertCount: alertRows.length, stockCount: groups.length },
    200,
  );
});
