import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  FlaskConical,
  ListChecks,
  Lock,
  ScrollText,
  ShieldAlert,
  Target,
} from "lucide-react";

import { Logo } from "@/components/layout/logo";
import { createClient } from "@/lib/supabase/server";

/**
 * Public landing page — the only route outside `(app)` that renders content
 * rather than a form, and the reason `/` is listed in `PUBLIC_PATHS` in
 * `lib/supabase/proxy.ts`. The cockpit that used to live here moved to
 * `/dashboard`; two routes cannot both answer to `/`.
 *
 * It is session-aware rather than session-gated: a signed-in visitor still
 * sees the page, but every call to action becomes "open the cockpit" instead
 * of "sign up". A hard redirect would mean you could never read your own
 * product's front page while logged in.
 */
export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: ScrollText,
    step: "01",
    title: "Thesis",
    body: "Say what you believe in plain language — a sector, a catalyst, or a single ticker. Jarvis shortlists the candidates that actually fit and prices every one of them live.",
  },
  {
    icon: ShieldAlert,
    step: "02",
    title: "Stress test",
    body: "Before the trade, not after: the bear cases, the ways the thesis breaks, and the one number that would prove you wrong.",
  },
  {
    icon: Target,
    step: "03",
    title: "Trade plan",
    body: "An entry zone, an add tranche, a stop and staged targets — costed, checked for a sane risk/reward, and written down before you have money on the line.",
  },
  {
    icon: BookOpen,
    step: "04",
    title: "Exit discipline",
    body: "The rules that get you out, and a journal that scores how well you followed them. Discipline breaks are recorded, not quietly forgotten.",
  },
];

const POINTS = [
  {
    icon: FlaskConical,
    title: "It compares, then commits",
    body: "Name a stock or don't. Either way you get one memorandum covering every candidate side by side, with a pick and the reasoning — not a wall of neutral summaries that leaves the decision entirely to you.",
  },
  {
    icon: ListChecks,
    title: "It keeps score",
    body: "Every recommendation is tracked against what the price actually did, so you can see whether the process works rather than remembering only the trades that went well.",
  },
  {
    icon: Lock,
    title: "Your book is yours",
    body: "Each account's theses, positions and journal are isolated in the database itself by row-level security — not by application code remembering to filter.",
  },
];

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between px-6 sm:px-10">
        <div className="flex items-center gap-2">
          <Logo className="size-8 shrink-0" />
          <span className="font-display text-xl font-extrabold tracking-tighter text-on-surface">
            JARVIS
          </span>
        </div>
        {signedIn ? (
          <Link
            href="/dashboard"
            className="rounded-full bg-primary px-5 py-2 text-sm font-bold tracking-tight text-on-primary transition-all hover:bg-primary-dim active:scale-[0.97]"
          >
            Open the cockpit
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-white/5 hover:text-on-surface"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-primary px-5 py-2 text-sm font-bold tracking-tight text-on-primary transition-all hover:bg-primary-dim active:scale-[0.97]"
            >
              Sign up
            </Link>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 sm:px-10">
        {/* Hero */}
        <section className="flex flex-col items-center py-20 text-center sm:py-28">
          <span className="rounded-full bg-primary-container/20 px-3 py-1 font-mono text-xs tracking-widest text-primary uppercase">
            Decision support, never execution
          </span>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-extrabold leading-[1.05] tracking-tighter text-on-surface sm:text-6xl">
            Stop having opinions.
            <br />
            Start having plans.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-on-surface-variant sm:text-lg">
            Jarvis turns a hunch into a written trade plan — entry, stop, targets and the exact
            condition that would prove you wrong — then holds you to it while the market moves.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href={signedIn ? "/dashboard" : "/signup"}
              className="group flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.98]"
            >
              {signedIn ? "Open the cockpit" : "Create your account"}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2.5}
              />
            </Link>
            {signedIn ? null : (
              <Link
                href="/login"
                className="flex h-12 items-center rounded-full px-7 text-sm font-medium text-on-surface-variant transition-colors hover:bg-white/5 hover:text-on-surface"
              >
                I already have an account
              </Link>
            )}
          </div>
        </section>

        {/* The loop */}
        <section className="py-8">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
            The loop
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map(({ icon: Icon, step, title, body }) => (
              <div key={step} className="glass-panel rounded-xl p-6">
                <div className="flex items-center gap-3">
                  <Icon className="size-5 text-primary" strokeWidth={2} />
                  <span className="font-mono text-xs text-on-surface-variant">{step}</span>
                </div>
                <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-on-surface">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Why */}
        <section className="py-16">
          <div className="grid gap-10 sm:grid-cols-3">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="size-5 text-primary" strokeWidth={2} />
                <h3 className="mt-4 font-display text-base font-bold tracking-tight text-on-surface">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="glass-panel my-8 flex flex-col items-center rounded-xl px-6 py-14 text-center">
          <h2 className="max-w-lg font-display text-2xl font-extrabold tracking-tight text-on-surface sm:text-3xl">
            {signedIn ? "Your cockpit is waiting." : "Your next trade deserves a written plan."}
          </h2>
          <Link
            href={signedIn ? "/dashboard" : "/signup"}
            className="group mt-8 flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.98]"
          >
            {signedIn ? "Open the cockpit" : "Sign up"}
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2.5}
            />
          </Link>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10">
        <p className="max-w-2xl text-xs leading-relaxed text-on-surface-variant/70">
          Jarvis is a decision-support and record-keeping tool. It does not place orders, connect
          to a broker, or give investment advice, and nothing it produces is a recommendation to
          buy or sell anything. Market data is provided as-is and may be delayed or wrong. Every
          trade is your own decision and your own risk.
        </p>
        <p className="mt-6 font-mono text-xs text-on-surface-variant/50">JARVIS_OS</p>
      </footer>
    </div>
  );
}
