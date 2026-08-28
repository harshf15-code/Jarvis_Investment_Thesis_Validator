import { LogOut } from "lucide-react";

import { logout } from "@/app/(auth)/login/actions";

/**
 * Lives in the header rather than floating over the bottom-right of the canvas
 * as it did before, where it overlapped page content and collided with the
 * mobile nav bar. Server component — `logout` is a server action.
 */
export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        aria-label="Log out"
        className="group relative flex size-9 items-center justify-center rounded-full text-on-surface-variant/70 transition-colors hover:bg-white/5 hover:text-on-surface"
      >
        <LogOut className="size-4" strokeWidth={2} />
        <span className="pointer-events-none absolute top-full right-0 z-50 mt-2 hidden whitespace-nowrap rounded-md bg-surface-container-highest px-2.5 py-1.5 text-xs font-medium text-on-surface shadow-panel group-hover:block">
          Log out
        </span>
      </button>
    </form>
  );
}
