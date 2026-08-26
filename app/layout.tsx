import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "@/styles/tokens.css";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Jarvis Watchlist Tracker",
  description: "Jarvis Watchlist Tracker",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${plusJakartaSans.variable} ${inter.variable}`}
    >
      {/* App is permanently dark-themed — body background is set explicitly
          to the `surface` token, never left to default white. */}
      <body className="bg-surface text-on-surface antialiased">
        {children}
      </body>
    </html>
  );
}
