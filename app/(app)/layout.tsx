import type { ReactNode } from "react";

import { logout } from "@/app/(auth)/login/actions";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/*
        Minimal logout control — full nav chrome comes later. Only rendered
        inside the (app) route group, which the auth middleware guarantees is
        never reached without a valid session, so no separate "am I logged
        in" check is needed here.
      */}
      <form
        action={logout}
        className="fixed right-4 bottom-4 z-50"
      >
        <button
          type="submit"
          className="rounded-xl bg-surface-container-highest px-3 py-1.5 text-xs font-medium text-on-surface/70 transition-colors hover:text-on-surface"
        >
          Log out
        </button>
      </form>
    </>
  );
}
