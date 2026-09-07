import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "@/styles/tokens.css";
import "./globals.css";

/**
 * Type stack from the Stitch project (see styles/tokens.css). Plus Jakarta Sans
 * carries headlines and numerics; Inter is the interface workhorse. The app
 * previously set DM Mono as the `sans` face, so every paragraph, label, and
 * button rendered in monospace.
 *
 * `next/font` self-hosts EVERY weight declared here, so each one is a woff2 the
 * browser fetches on first paint. Two of Inter's were fetched and never used:
 * `font-light` appears nowhere in the codebase, and the single `font-semibold`
 * sits on a `font-display` element, so it resolves to Jakarta.
 *
 * Jakarta keeps all five. Its 500 has no direct `font-display font-medium`
 * pairing, but a `font-medium` child inside a `font-display` heading would
 * inherit the family and want the weight, and that is not worth a hunt to save
 * one file.
 *
 * Worth knowing, and NOT changed here: 19 places apply `font-extrabold` to text
 * that resolves to Inter, which ships nothing above 700 — so those render as
 * 700 or a synthesized bold today. Adding Inter 800 would change how the app
 * looks, which is a design decision and does not belong in a performance pass.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-inter",
});

// Reserved for tabular figures only: prices, tickers, ids.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "JARVIS_OS | Trading Decision Cockpit",
  description: "Jarvis Decision Cockpit",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${jakarta.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-surface text-on-surface font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
