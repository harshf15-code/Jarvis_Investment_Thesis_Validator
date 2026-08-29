"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Logo } from "@/components/layout/logo";
import type { AuthState } from "@/app/(auth)/login/actions";

/**
 * Shared shell for /login and /signup so the two never drift apart.
 *
 * Hand-rolled inputs rather than `components/ui/input.tsx`: that primitive is
 * styled against the shadcn token names (`bg-background`, `border-input`),
 * while this app's own palette lives in `styles/tokens.css`. The two systems
 * coexist in this codebase; the auth screens follow the app's. The field style
 * is the design system's "bottom-heavy" rule — flat body, no border except a
 * 2px primary underline on focus.
 */

const FIELD_CLASS =
  "h-11 w-full rounded-t-lg border-0 border-b-2 border-b-transparent bg-surface-container-highest px-3 text-on-surface outline-none transition-colors placeholder:text-on-surface/40 focus:border-b-primary";

export type AuthMode = "login" | "signup";

export function AuthForm({
  mode,
  action,
}: {
  mode: AuthMode;
  action: (formData: FormData) => Promise<AuthState>;
}) {
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const isSignup = mode === "signup";

  function handleSubmit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await action(formData);
      // On success the action redirects server-side and never resolves back
      // here with a value; a returned value always means it stopped short.
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
          {isSignup ? "Create your account" : "Jarvis Decision Cockpit"}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          {isSignup
            ? "Your theses, positions and journal are yours alone."
            : "Sign in to continue."}
        </p>

        <form action={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId} className="text-on-surface">
              Email
            </Label>
            <input
              id={emailId}
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              aria-invalid={error ? "true" : undefined}
              className={FIELD_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId} className="text-on-surface">
              Password
            </Label>
            <input
              id={passwordId}
              name="password"
              type="password"
              required
              minLength={isSignup ? 8 : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              aria-invalid={error ? "true" : undefined}
              className={FIELD_CLASS}
            />
            {isSignup ? (
              <p className="text-xs text-on-surface-variant">At least 8 characters.</p>
            ) : null}
          </div>

          {isSignup ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={confirmId} className="text-on-surface">
                Confirm password
              </Label>
              <input
                id={confirmId}
                name="confirm_password"
                type="password"
                required
                autoComplete="new-password"
                aria-invalid={error ? "true" : undefined}
                className={FIELD_CLASS}
              />
            </div>
          ) : null}

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
            {isPending
              ? isSignup
                ? "Creating…"
                : "Signing in…"
              : isSignup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-on-surface-variant">
          {isSignup ? "Already have an account? " : "No account yet? "}
          <Link
            href={isSignup ? "/login" : "/signup"}
            className="font-medium text-primary hover:underline"
          >
            {isSignup ? "Sign in" : "Sign up"}
          </Link>
        </p>
      </div>
    </main>
  );
}
