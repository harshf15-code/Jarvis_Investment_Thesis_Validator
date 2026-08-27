"use client";

import { useCallback, useState } from "react";

/**
 * Fetches fresh prices for `stockIds` from `POST /api/prices/refresh` and
 * calls `router.refresh()`-equivalent via `onRefreshed` so the calling
 * server component re-renders with updated `stocks.last_price`. Every
 * screen that lists tickers calls `refresh()` once on mount (via a
 * `useEffect` in the calling component) and wires it to a "Refresh Prices"
 * button — this hook itself has no auto-polling (spec's global Price Data
 * rule).
 */
export function usePriceRefresh(stockIds: string[], onRefreshed?: () => void) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (stockIds.length === 0) return;
    setRefreshing(true);
    try {
      await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockIds }),
      });
      onRefreshed?.();
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockIds.join(","), onRefreshed]);

  return { refresh, refreshing };
}
