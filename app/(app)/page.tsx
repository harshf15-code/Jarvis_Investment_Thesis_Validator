import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Placeholder home page — proves the Neon Velocity token wiring (Tailwind
 * config -> CSS custom properties -> rendered styles) works end to end.
 * Replaced by the real dashboard in Task 6.
 */
export default function AppHomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-24">
      <h1 className="font-display text-6xl font-bold text-on-surface">
        Jarvis Watchlist Tracker
      </h1>

      <Card className="w-full max-w-md rounded-xl bg-surface-container-low shadow-none ring-0">
        <CardHeader>
          <CardTitle className="text-on-surface">
            Token wiring check
          </CardTitle>
          <CardDescription className="text-on-surface/70">
            This card proves the design tokens render from CSS variables, not
            hardcoded hex values.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-on-surface">
          <p>
            Surface tiers, the primary gradient, and body text all resolve
            through <code>styles/tokens.css</code>.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
