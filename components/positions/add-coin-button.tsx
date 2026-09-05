"use client";

import { useState } from "react";
import { Bitcoin } from "lucide-react";

import { AddCoinModal } from "./add-coin-modal";

/**
 * The trigger for `AddCoinModal`, split out so `/positions` can stay a server
 * component. Opening a modal is client state and nothing else here is.
 *
 * Rendered in the page header rather than inside `PositionsPageClient`, for the
 * same reason "Import Holdings" is: the empty branch skips that component
 * entirely, which would hide this from exactly the trader who holds nothing in
 * Jarvis yet and has the most to add.
 */
export function AddCoinButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-white/25 hover:text-on-surface"
      >
        <Bitcoin className="size-3.5" />
        Add a Coin
      </button>
      {open && <AddCoinModal onClose={() => setOpen(false)} />}
    </>
  );
}
