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

/**
 * How far back the unemailed-alerts query looks. Without a floor, if
 * sending ever fails for an extended period, `emailed_at is null` rows
 * accumulate unboundedly -- every scheduled run re-fetches (and, on
 * success, re-updates) an ever-growing set, and the batch update-by-id-list
 * below could eventually hit a PostgREST URL length limit. 7 days
 * comfortably covers this app's once-daily digest cadence with room for a
 * multi-day outage to recover from, while bounding the worst case.
 */
const UNEMAILED_ALERTS_LOOKBACK_DAYS = 7;

/**
 * Batch size for the `emailed_at` update-by-id-list. Chunked so that a
 * large backlog (see `UNEMAILED_ALERTS_LOOKBACK_DAYS` above) can never
 * produce a single `.in("id", [...])` PostgREST call with an unbounded
 * number of ids in its URL.
 */
const EMAILED_UPDATE_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

Deno.serve(async (_req: Request) => {
  const supabase = createAdminClient();

  const lookbackFloor = new Date(
    Date.now() - UNEMAILED_ALERTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: alertRows, error: alertError } = await supabase
    .from("position_alerts")
    .select("id, position_id, alert_type, triggered_at, details")
    .is("emailed_at", null)
    .gt("triggered_at", lookbackFloor)
    .order("triggered_at", { ascending: true });

  if (alertError) {
    return jsonResponse({ error: alertError.message }, 500);
  }
  if (!alertRows || alertRows.length === 0) {
    return jsonResponse({ sent: false, reason: "no unemailed alerts" }, 200);
  }

  const positionIds = [...new Set(alertRows.map((r) => r.position_id as string))];
  const { data: positionRows, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker")
    .in("id", positionIds);
  if (positionsError) {
    return jsonResponse({ error: positionsError.message }, 500);
  }
  const tickerByPositionId = new Map<string, string>(
    (positionRows ?? []).map((p: { id: string; ticker: string }) => [p.id, p.ticker]),
  );

  const enrichedRows = alertRows.map((row) => ({
    stock_id: row.position_id as string, // `groupAlertsByStock` groups on this key name; semantics is now "position"
    ticker: tickerByPositionId.get(row.position_id as string) ?? "UNKNOWN",
    trigger_type: row.alert_type as string,
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
  //
  // Chunked (`EMAILED_UPDATE_BATCH_SIZE` ids per `.in(...)` call) rather
  // than one call with every id, so a large backlog can never produce a
  // single request whose URL is too long for PostgREST.
  const alertLogIds = alertRows.map((r) => r.id);
  const emailedAt = new Date().toISOString();
  for (const idBatch of chunk(alertLogIds, EMAILED_UPDATE_BATCH_SIZE)) {
    const { error: updateError } = await supabase
      .from("position_alerts")
      .update({ emailed_at: emailedAt })
      .in("id", idBatch);

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
  }

  return jsonResponse(
    { sent: true, alertCount: alertRows.length, stockCount: groups.length },
    200,
  );
});
