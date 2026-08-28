"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Without this boundary, a throw in any Server Component under `(app)` renders
 * Next's bare fallback — "A server error occurred" over an error digest — and
 * the only way to learn anything is to go read the platform logs. The message
 * itself is still withheld from the browser in production (Next redacts it, so
 * a stack trace can never leak to a viewer), but the digest shown here is the
 * exact key to grep for in `vercel logs`, and the retry avoids a full reload.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <AlertTriangle className="size-8 text-error" />
      <h1 className="font-display text-xl text-on-surface">This screen could not load.</h1>
      <p className="max-w-md text-sm text-on-surface-variant">
        {error.message || "The server hit an error while reading your data."}
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-on-surface-variant/70">
          Reference: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-dim"
      >
        Try again
      </button>
    </div>
  );
}
