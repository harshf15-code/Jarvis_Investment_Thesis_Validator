import { AddTickerForm } from "@/components/add-ticker/add-ticker-form";

/**
 * Add-ticker page: watchlist/holding entry point, `POST`ed to
 * `app/api/stocks/route.ts`. Not the dashboard (that's Task 6's
 * `app/(app)/page.tsx`) — just this one form, behind the same auth gate as
 * every other `(app)` route.
 */
export default function AddTickerPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-8">
        <h1 className="font-display text-2xl font-bold text-on-surface">
          Add a stock
        </h1>
        <p className="mt-1 text-sm text-on-surface/70">
          Track it on your watchlist, or record it as a holding.
        </p>

        <AddTickerForm />
      </div>
    </main>
  );
}
