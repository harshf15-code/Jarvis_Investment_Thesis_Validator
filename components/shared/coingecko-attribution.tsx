/**
 * CoinGecko's required attribution.
 *
 * MANDATORY, not decorative. Their attribution guide requires visible,
 * hyperlinked credit placed "close to where the data is displayed, i.e. above
 * or below the data set" — so this goes next to prices, never in a footer and
 * never on an About page.
 *
 * One component so the wording cannot drift between the surfaces that render a
 * coin price. The text is one of their approved phrasings verbatim; do not
 * reword it.
 *
 * Renders nothing when no crypto is on screen: attribution for data that is
 * not shown is noise, and noise is what gets deleted later by someone who
 * assumes it was decorative.
 */
export function CoinGeckoAttribution({
  show = true,
  className,
}: {
  show?: boolean;
  className?: string;
}) {
  if (!show) return null;
  return (
    <p className={`text-[10px] text-on-surface-variant/60 ${className ?? ""}`}>
      Price data by{" "}
      <a
        href="https://www.coingecko.com"
        target="_blank"
        rel="noreferrer noopener"
        className="underline transition-colors hover:text-on-surface-variant"
      >
        CoinGecko
      </a>
    </p>
  );
}
