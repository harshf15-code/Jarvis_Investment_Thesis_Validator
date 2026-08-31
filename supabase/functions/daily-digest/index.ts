// Deno Edge Function — NOT part of the Next.js build/lint/test pipeline.
// Written in Task 11 but NOT deployed and NOT wired to a real `pg_cron`
// schedule yet — that happens later with the user against the real
// Supabase project.

import { createAdminClient } from "../_shared/supabase-client.ts";
import {
  groupAlertsByStock,
  renderDigestHtml,
  renderDigestText,
  type DigestSignal,
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

/**
 * Resolves each owner's email address from `auth.users`. Runs on the
 * service-role key, which is what makes the admin auth API available here.
 * A user who has since been deleted resolves to `null` and falls back to
 * `DIGEST_RECIPIENT_EMAIL`, so their alerts are still seen by someone rather
 * than silently dropped.
 */
async function resolveRecipients(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userIds: string[],
): Promise<Map<string, string>> {
  const byUserId = new Map<string, string>();
  for (const userId of userIds) {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user?.email) {
        console.error(`daily-digest: no email for user ${userId}`, error);
        continue;
      }
      byUserId.set(userId, data.user.email as string);
    } catch (err) {
      console.error(`daily-digest: failed to look up user ${userId}`, err);
    }
  }
  return byUserId;
}

/**
 * One digest per account.
 *
 * This used to send a single email to a `DIGEST_RECIPIENT_EMAIL` secret,
 * which was correct while the app had one shared login. With real accounts
 * that would mail every user's stop-loss and trim alerts to whoever owns that
 * address — a data leak, and useless to the people whose positions they are.
 * Alerts are therefore grouped by owner and sent separately, and a user's rows
 * are marked emailed only after *their* send succeeds, so one failed recipient
 * never suppresses another's alerts on the next run.
 */
Deno.serve(async (_req: Request) => {
  const supabase = createAdminClient();

  const lookbackFloor = new Date(
    Date.now() - UNEMAILED_ALERTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: alertRows, error: alertError } = await supabase
    .from("position_alerts")
    .select("id, position_id, user_id, alert_type, triggered_at, details")
    .is("emailed_at", null)
    .gt("triggered_at", lookbackFloor)
    .order("triggered_at", { ascending: true });

  if (alertError) {
    return jsonResponse({ error: alertError.message }, 500);
  }

  // Feed rows the per-holding watch wrote (0022). Same lookback and the same
  // `emailed_at` contract as alerts, so a signal is marked sent only after a
  // confirmed send and a failed run simply retries it.
  const { data: signalRows, error: signalError } = await supabase
    .from("intelligence_signals")
    .select("id, user_id, ticker, headline, priority, created_at")
    .is("emailed_at", null)
    .is("archived_at", null)
    .gt("created_at", lookbackFloor)
    .order("created_at", { ascending: true });

  if (signalError) {
    return jsonResponse({ error: signalError.message }, 500);
  }

  const alerts = alertRows ?? [];
  const signals = signalRows ?? [];
  if (alerts.length === 0 && signals.length === 0) {
    return jsonResponse({ sent: false, reason: "nothing unemailed" }, 200);
  }

  const positionIds = [...new Set(alerts.map((r) => r.position_id as string))];
  const { data: positionRows, error: positionsError } = positionIds.length
    ? await supabase
        .from("positions")
        .select("id, ticker")
        .in("id", positionIds)
    : { data: [], error: null };
  if (positionsError) {
    return jsonResponse({ error: positionsError.message }, 500);
  }
  const tickerByPositionId = new Map<string, string>(
    (positionRows ?? []).map((p: { id: string; ticker: string }) => [
      p.id,
      p.ticker,
    ]),
  );

  // Alerts predating accounts (and any whose owner has been deleted) group
  // under this key and go to the fallback address.
  const UNOWNED = "__unowned__";
  const alertsByUser = new Map<string, typeof alerts>();
  for (const row of alerts) {
    const key = (row.user_id as string | null) ?? UNOWNED;
    const list = alertsByUser.get(key) ?? [];
    list.push(row);
    alertsByUser.set(key, list);
  }

  const signalsByUser = new Map<string, typeof signals>();
  for (const row of signals) {
    const key = (row.user_id as string | null) ?? UNOWNED;
    const list = signalsByUser.get(key) ?? [];
    list.push(row);
    signalsByUser.set(key, list);
  }

  // Every recipient who has anything at all. A trader whose only news this run
  // is a watch flag must still get an email.
  const recipientKeys = [
    ...new Set([...alertsByUser.keys(), ...signalsByUser.keys()]),
  ];

  const fallbackTo = Deno.env.get("DIGEST_RECIPIENT_EMAIL") ?? null;
  const emailByUserId = await resolveRecipients(
    supabase,
    recipientKeys.filter((k) => k !== UNOWNED),
  );

  const emailedAt = new Date().toISOString();
  let sentCount = 0;
  const failures: string[] = [];

  for (const userKey of recipientKeys) {
    const rows = alertsByUser.get(userKey) ?? [];
    const userSignals = signalsByUser.get(userKey) ?? [];
    const to =
      userKey === UNOWNED
        ? fallbackTo
        : (emailByUserId.get(userKey) ?? fallbackTo);
    if (!to) {
      console.error(
        `daily-digest: no recipient for ${userKey} and DIGEST_RECIPIENT_EMAIL is unset; ` +
          `${rows.length} alert(s) and ${userSignals.length} signal(s) left unemailed for the next run`,
      );
      failures.push(userKey);
      continue;
    }

    const enrichedRows = rows.map((row) => ({
      stock_id: row.position_id as string, // `groupAlertsByStock` groups on this key name; semantics is now "position"
      ticker: tickerByPositionId.get(row.position_id as string) ?? "UNKNOWN",
      trigger_type: row.alert_type as string,
      triggered_at: row.triggered_at as string,
      details: row.details,
    }));

    const groups = groupAlertsByStock(enrichedRows);
    const digestSignals: DigestSignal[] = userSignals.map((s) => ({
      ticker: s.ticker as string | null,
      headline: s.headline as string,
      priority: s.priority as string,
      created_at: s.created_at as string,
    }));

    try {
      await sendDigestEmail(
        renderDigestHtml(groups, digestSignals),
        renderDigestText(groups, digestSignals),
        to,
      );
    } catch (err) {
      // Left `emailed_at is null` on purpose so the next scheduled run
      // retries them, rather than dropping alerts on a transient failure.
      console.error(`daily-digest: sendDigestEmail failed for ${userKey}`, err);
      failures.push(userKey);
      continue;
    }

    // Only mark rows emailed AFTER a confirmed successful send.
    //
    // Chunked (`EMAILED_UPDATE_BATCH_SIZE` ids per `.in(...)` call) rather
    // than one call with every id, so a large backlog can never produce a
    // single request whose URL is too long for PostgREST.
    for (const [table, ids] of [
      ["position_alerts", rows.map((r) => r.id)],
      ["intelligence_signals", userSignals.map((r) => r.id)],
    ] as const) {
      for (const idBatch of chunk(ids as string[], EMAILED_UPDATE_BATCH_SIZE)) {
        const { error: updateError } = await supabase
          .from(table)
          .update({ emailed_at: emailedAt })
          .in("id", idBatch);

        if (updateError) {
          // The email already went out at this point; failing to mark rows
          // emailed means the next run may re-send them. Surface it loudly
          // rather than silently swallowing it.
          console.error(
            `daily-digest: email sent to ${userKey} but failed to mark rows emailed`,
            updateError,
          );
          failures.push(userKey);
        }
      }
    }

    sentCount++;
  }

  return jsonResponse(
    {
      sent: sentCount > 0,
      recipients: sentCount,
      alertCount: alerts.length,
      signalCount: signals.length,
      failures,
    },
    failures.length > 0 && sentCount === 0 ? 502 : 200,
  );
});
