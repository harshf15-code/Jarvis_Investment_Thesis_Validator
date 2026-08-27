import type { ReactNode } from "react";

import { logout } from "@/app/(auth)/login/actions";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NewThesisDrawer } from "@/components/layout/new-thesis-drawer";
import { NewThesisProvider } from "@/components/layout/new-thesis-context";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <NewThesisProvider>
      <AppSidebar />
      <main className="min-h-screen xl:pl-60">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
      <NewThesisDrawer />
      <form action={logout} className="fixed right-4 bottom-4 z-40">
        <button
          type="submit"
          className="rounded-xl bg-surface-container-highest px-3 py-1.5 text-xs font-medium text-on-surface/70 transition-colors hover:text-on-surface"
        >
          Log out
        </button>
      </form>
    </NewThesisProvider>
  );
}
