"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type NewThesisContextValue = {
  isOpen: boolean;
  open: (prefillTicker?: string) => void;
  close: () => void;
  prefillTicker: string | undefined;
};

const NewThesisContext = createContext<NewThesisContextValue | null>(null);

export function NewThesisProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefillTicker, setPrefillTicker] = useState<string | undefined>(undefined);

  return (
    <NewThesisContext.Provider
      value={{
        isOpen,
        open: (ticker) => {
          setPrefillTicker(ticker);
          setIsOpen(true);
        },
        close: () => setIsOpen(false),
        prefillTicker,
      }}
    >
      {children}
    </NewThesisContext.Provider>
  );
}

/** Consumed by any screen's "New Thesis" / "+" affordance (spec's global rule: accessible from every screen without navigating away). */
export function useNewThesisDrawer(): NewThesisContextValue {
  const ctx = useContext(NewThesisContext);
  if (!ctx) {
    throw new Error("useNewThesisDrawer must be used within NewThesisProvider");
  }
  return ctx;
}
