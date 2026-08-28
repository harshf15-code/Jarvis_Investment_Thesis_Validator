"use client";

import { useId, useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Logo } from "@/components/layout/logo";

import { login } from "./actions";

/**
 * Single shared-password login gate. No accounts, no "forgot password" —
 * just one field. Keeps the design system's "bottom-heavy" input rule (flat
 * field body, no border except a 2px primary highlight on focus).
 */
export default function LoginPage() {
  const passwordId = useId();
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await login(formData);
      // On success `login` redirects server-side and never resolves back
      // here with a value; a returned value always means failure.
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24">
      <div className="glass-panel w-full max-w-sm rounded-xl p-8">
        <Logo className="size-14" />
        <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-on-surface">
          Jarvis Decision Cockpit
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Enter the password to continue.
        </p>

        <form action={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId} className="text-on-surface">
              Password
            </Label>
            <input
              id={passwordId}
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              aria-invalid={error ? "true" : undefined}
              className="h-11 w-full rounded-t-lg border-0 border-b-2 border-b-transparent bg-surface-container-highest px-3 text-on-surface outline-none transition-colors placeholder:text-on-surface/40 focus:border-b-primary"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-error-container/10 px-3 py-2 text-sm text-error"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="mt-2 h-11 rounded-full bg-primary text-sm font-bold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.98] disabled:opacity-60"
          >
            {isPending ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
