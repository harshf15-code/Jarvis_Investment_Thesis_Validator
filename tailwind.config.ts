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

        // Neon Velocity design tokens (see Global Constraints / styles/tokens.css).
        // `primary` and `secondary` deliberately override shadcn's own keys above
        // so every primitive (Button, Badge, ...) inherits the brand palette.
        surface: "var(--color-surface)",
        "surface-container-lowest": "var(--color-surface-container-lowest)",
        "surface-container-low": "var(--color-surface-container-low)",
        "surface-container-high": "var(--color-surface-container-high)",
        "surface-container-highest": "var(--color-surface-container-highest)",
        "surface-variant": "var(--color-surface-variant)",
        primary: "var(--color-primary)",
        "primary-container": "var(--color-primary-container)",
        "on-primary": "var(--color-on-primary)",
        "on-surface": "var(--color-on-surface)",
        secondary: "var(--color-secondary)",
        "secondary-container": "var(--color-secondary-container)",
        error: "var(--color-error)",
        "error-container": "var(--color-error-container)",
        "outline-variant": "var(--color-outline-variant)",
        "status-red": "var(--color-status-red)",
        "status-red-container": "var(--color-status-red-container)",
        "status-green": "var(--color-status-green)",
        "status-green-container": "var(--color-status-green-container)",
        "status-blue": "var(--color-status-blue)",
        "status-blue-container": "var(--color-status-blue-container)",
      },
      borderRadius: {
        xl: "1.5rem",
      },
      boxShadow: {
        // Ultra-diffused ambient shadow for glass/floating elements only
        // (modals, dropdowns, hover popovers) — never used on flat cards.
        ambient: "0 20px 40px rgba(0,0,0,0.4)",
      },
      fontFamily: {
        // Syne: headings/labels. DM Mono: body/data/numbers (spec Section 1).
        display: ["var(--font-syne)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
