import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // shadcn/ui's own neutral-base tokens (from app/globals.css `:root`/`.dark`),
        // left untouched so the installed primitives render correctly out of the box.
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover: "var(--popover)",
        "popover-foreground": "var(--popover-foreground)",
        "primary-foreground": "var(--primary-foreground)",
        "secondary-foreground": "var(--secondary-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        destructive: "var(--destructive)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",

        // "Kinetic Terminal" tokens (styles/tokens.css). `primary`/`secondary`
        // deliberately override shadcn's keys above so every primitive
        // (Button, Badge, ...) inherits the brand palette.
        surface: "var(--color-surface)",
        "surface-dim": "var(--color-surface-dim)",
        "surface-container-lowest": "var(--color-surface-container-lowest)",
        "surface-container-low": "var(--color-surface-container-low)",
        "surface-container": "var(--color-surface-container)",
        "surface-container-high": "var(--color-surface-container-high)",
        "surface-container-highest": "var(--color-surface-container-highest)",
        "surface-variant": "var(--color-surface-variant)",
        "surface-bright": "var(--color-surface-bright)",
        primary: "var(--color-primary)",
        "primary-dim": "var(--color-primary-dim)",
        "primary-container": "var(--color-primary-container)",
        "on-primary": "var(--color-on-primary)",
        "on-surface": "var(--color-on-surface)",
        "on-surface-variant": "var(--color-on-surface-variant)",
        secondary: "var(--color-secondary)",
        "secondary-container": "var(--color-secondary-container)",
        error: "var(--color-error)",
        "error-container": "var(--color-error-container)",
        outline: "var(--color-outline)",
        "outline-variant": "var(--color-outline-variant)",
        "status-red": "var(--color-status-red)",
        "status-red-container": "var(--color-status-red-container)",
        "status-green": "var(--color-status-green)",
        "status-green-container": "var(--color-status-green-container)",
        "status-blue": "var(--color-status-blue)",
        "status-blue-container": "var(--color-status-blue-container)",
        "status-amber": "var(--color-status-amber)",
        "status-amber-container": "var(--color-status-amber-container)",
      },
      // Stitch's scale. The previous config overrode `xl` to 1.5rem, which made
      // every card read as a lozenge; the mocks are 8/12/16px.
      borderRadius: {
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        // The mocks' "rh-shadow": a deep, diffused lift for panels.
        panel: "0 8px 32px rgba(0,0,0,0.45)",
        // Ambient glow under the primary CTA only — never on a flat card.
        ambient: "0 10px 30px -10px rgba(0,200,5,0.5)",
      },
      fontFamily: {
        // Plus Jakarta Sans: headlines/numerics. Inter: everything else.
        // The previous config set `sans` to DM Mono, so the ENTIRE app rendered
        // in a monospace face — the single biggest reason it read as unpolished.
        display: ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
