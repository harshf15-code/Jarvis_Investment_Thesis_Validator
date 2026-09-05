"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { usePortfolios } from "@/components/layout/portfolio-context";
import { PortfolioPicker } from "@/components/portfolio/portfolio-picker";
import { CoinGeckoAttribution } from "@/components/shared/coingecko-attribution";
import { localToday } from "@/lib/portfolio-import";

/**
 * Logs one coin already owned.
 *
 * The CSV import is the bulk path; this is the single-coin one, and without it
 * recording one BTC buy means writing a spreadsheet to import.
 *
 * The coin is CHOSEN FROM A LIST, never typed. That is the whole point of the
 * feature: a free-text ticker is exactly how "BTC" resolves on Yahoo to a
 * US-listed Bitcoin trust — the wrong asset, with no error anywhere. A list of
 * ten cannot be misspelled into something else that exists.
 *
 * Nothing here asks for a currency. The book decides it, the server reads it
 * from the book, and the form only says which one it will be — a trader who
 * could pick a currency here could disagree with the book they are filing
 * into, and there is no right answer to that disagreement.
 */

type Coin = {
  coingecko_id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
};

export function AddCoinModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { portfolios } = usePortfolios();

  const [coins, setCoins] = useState<Coin[]>([]);
  const [loadingCoins, setLoadingCoins] = useState(true);
  const [coinsError, setCoinsError] = useState<string | null>(null);

  // Starts null and stays null until the trader picks. See `PortfolioPicker`.
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [coingeckoId, setCoingeckoId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(localToday());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/crypto/universe");
        const body = await res.json();
        // `res.ok` is checked before the body is trusted: a failed fetch that
        // returns `{ error }` would otherwise read as an empty coin list, and
        // "there are no coins" is a very different thing to tell someone than
        // "we could not reach the list".
        if (!res.ok) throw new Error(body.error ?? "Could not load the tracked coins.");
        if (!cancelled) setCoins(body.coins ?? []);
      } catch (err) {
        if (!cancelled) {
          setCoinsError(err instanceof Error ? err.message : "Could not load the tracked coins.");
        }
      } finally {
        if (!cancelled) setLoadingCoins(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const book = portfolios.find((p) => p.id === portfolioId) ?? null;
  const coin = coins.find((c) => c.coingecko_id === coingeckoId) ?? null;
  const ready =
    Boolean(portfolioId) && Boolean(coingeckoId) && Number(quantity) > 0 && Number(price) > 0;

  async function handleSubmit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          coingecko_id: coingeckoId,
          quantity: Number(quantity),
          price: Number(price),
          date,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not add that coin.");
      onClose();
      router.push(`/positions/${body.position.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that coin.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-1 font-display text-lg text-on-surface">Add a Coin</h2>
        <p className="mb-4 text-xs text-on-surface/50">
          A coin you already hold. Jarvis records it and prices it hourly — it does not buy
          anything.
        </p>

        <div className="mb-4">
          <PortfolioPicker value={portfolioId} onChange={setPortfolioId} disabled={submitting} />
        </div>

        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="add-coin-coin" className="text-xs text-on-surface-variant">
            Which coin?
          </label>
          {coinsError ? (
            <p className="text-xs text-status-red">{coinsError}</p>
          ) : (
            <select
              id="add-coin-coin"
              value={coingeckoId}
              onChange={(e) => setCoingeckoId(e.target.value)}
              disabled={loadingCoins || submitting}
              className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm disabled:opacity-40"
            >
              <option value="">{loadingCoins ? "Loading…" : "Choose a coin"}</option>
              {coins.map((c) => (
                <option key={c.coingecko_id} value={c.coingecko_id}>
                  {c.symbol} — {c.name}
                </option>
              ))}
            </select>
          )}
          <p className="text-[11px] text-on-surface-variant/70">
            The top ten by market cap. A coin that later falls out keeps everything it has here;
            it just stops being offered for new holdings.
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-coin-qty" className="text-xs text-on-surface-variant">
              How much do you hold?
            </label>
            <input
              id="add-coin-qty"
              type="number"
              // Ten decimals, because 0029 widened the column for exactly this:
              // a satoshi-level lot must not round to zero on the way in.
              step="any"
              inputMode="decimal"
              placeholder="0.0043"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={submitting}
              className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-coin-price" className="text-xs text-on-surface-variant">
              Average price paid{book ? ` (${book.base_currency})` : ""}
            </label>
            <input
              id="add-coin-price"
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="7515223"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={submitting}
              className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="add-coin-date" className="text-xs text-on-surface-variant">
            Held since
          </label>
          <input
            id="add-coin-date"
            type="date"
            value={date}
            // The server refuses a future cost basis too. This only stops the
            // trader reaching a refusal they could have been spared.
            max={localToday()}
            onChange={(e) => setDate(e.target.value)}
            disabled={submitting}
            className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
          />
        </div>

        {coin && book && (
          <p className="mb-4 rounded-lg bg-white/5 px-3 py-2 text-xs text-on-surface-variant">
            {coin.symbol} will be priced in {book.base_currency}, the base currency of{" "}
            {book.name}.
          </p>
        )}

        {error && <p className="mb-4 text-xs text-status-red">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <CoinGeckoAttribution />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl px-4 py-2 text-sm text-on-surface/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!ready || submitting}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
            >
              {submitting ? "Adding…" : "Add Coin"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
