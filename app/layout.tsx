import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "@/styles/tokens.css";
import "./globals.css";

/**
 * Type stack from the Stitch project (see styles/tokens.css). Plus Jakarta Sans
 * carries headlines and numerics; Inter is the interface workhorse. The app
 * previously set DM Mono as the `sans` face, so every paragraph, label, and
 * button rendered in monospace.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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
