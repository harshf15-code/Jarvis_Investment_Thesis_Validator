"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ExchangeCode, StockType } from "@/lib/types";

/**
 * Add-ticker form. Follows the same "bottom-heavy" input pattern
 * (`app/(auth)/login/page.tsx`) rather than `components/ui/input.tsx` /
 * `select.tsx`, which still carry shadcn's own (non-Neon-Velocity) token
 * classes — see those files' comments.
 *
 * IMPORTANT: this is a client component. It only ever talks to
 * `POST /api/stocks` over `fetch`; it must never import
 * `lib/supabase/admin.ts` or reference `SUPABASE_SERVICE_ROLE_KEY` (that key
 * is server-only and is not exposed to the client bundle).
 */

const inputClassName =
  "h-11 w-full rounded-t-lg border-0 border-b-2 border-b-transparent bg-surface-container-highest px-3 text-on-surface outline-none transition-colors placeholder:text-on-surface/40 focus:border-b-primary";

const EXCHANGES: ExchangeCode[] = ["NSE", "BSE", "US"];

type FieldErrors = {
  ticker?: string;
  general?: string;
};

export function AddTickerForm() {
  const router = useRouter();

  const tickerId = useId();
  const exchangeId = useId();
  const sharesId = useId();
  const costBasisId = useId();
  const dateAcquiredId = useId();

  const [ticker, setTicker] = useState("");
  const [exchange, setExchange] = useState<ExchangeCode>("NSE");
  const [type, setType] = useState<StockType>("watchlist");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [dateAcquired, setDateAcquired] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    const body =
      type === "holding"
        ? {
            ticker,
            exchange,
            type,
            shares: Number(shares),
            cost_basis: Number(costBasis),
            date_acquired: dateAcquired,
          }
        : { ticker, exchange, type };

    try {
      const response = await fetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        router.push("/");
        return;
      }

      const payload = await response.json().catch(() => null);
      const message =
        (payload && typeof payload.error === "string" && payload.error) ||
        "Something went wrong. Please try again.";

      if (response.status === 422) {
        // The ticker didn't resolve to a real quote — surface it inline on
        // the ticker field specifically, not as a generic banner.
        setErrors({ ticker: message });
      } else {
        setErrors({ general: message });
      }
    } catch {
      setErrors({ general: "Network error. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={tickerId} className="text-on-surface">
          Ticker
        </Label>
        <input
          id={tickerId}
          name="ticker"
          type="text"
          required
          autoFocus
          autoCapitalize="characters"
          placeholder="e.g. AAPL, RELIANCE"
          value={ticker}
          onChange={(event) => setTicker(event.target.value)}
          aria-invalid={errors.ticker ? "true" : undefined}
          className={inputClassName}
        />
        {errors.ticker ? (
          <p role="alert" className="text-sm text-error">
            {errors.ticker}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={exchangeId} className="text-on-surface">
          Exchange
        </Label>
        <select
          id={exchangeId}
          name="exchange"
          required
          value={exchange}
          onChange={(event) => setExchange(event.target.value as ExchangeCode)}
          className={inputClassName}
        >
          {EXCHANGES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-on-surface">List as</span>
        <div className="flex gap-2" role="group" aria-label="List as">
          {(["watchlist", "holding"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={type === option}
              onClick={() => setType(option)}
              className={cn(
                "h-9 flex-1 rounded-lg text-sm font-medium capitalize transition-colors",
                type === option
                  ? "bg-gradient-to-br from-primary to-primary-container text-on-primary"
                  : "bg-surface-container-highest text-on-surface/70 hover:text-on-surface",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {type === "holding" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={sharesId} className="text-on-surface">
              Shares
            </Label>
            <input
              id={sharesId}
              name="shares"
              type="number"
              min="0"
              step="any"
              required
              value={shares}
              onChange={(event) => setShares(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={costBasisId} className="text-on-surface">
              Cost basis (per share)
            </Label>
            <input
              id={costBasisId}
              name="cost_basis"
              type="number"
              min="0"
              step="any"
              required
              value={costBasis}
              onChange={(event) => setCostBasis(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dateAcquiredId} className="text-on-surface">
              Date acquired
            </Label>
            <input
              id={dateAcquiredId}
              name="date_acquired"
              type="date"
              required
              value={dateAcquired}
              onChange={(event) => setDateAcquired(event.target.value)}
              className={inputClassName}
            />
          </div>
        </>
      ) : null}

      {errors.general ? (
        <p
          role="alert"
          className="rounded-lg bg-error-container/10 px-3 py-2 text-sm text-error"
        >
          {errors.general}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 h-11 rounded-xl bg-gradient-to-br from-primary to-primary-container text-sm font-medium text-on-primary transition-opacity disabled:opacity-60"
      >
        {isSubmitting ? "Adding…" : "Add stock"}
      </button>
    </form>
  );
}
