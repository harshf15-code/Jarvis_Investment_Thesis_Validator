/**
 * The Jarvis mark. Inline SVG rather than an <img> so it scales crisply at any
 * size and never flashes in late on a dark background.
 *
 * Geometry and facet colours are sampled from the source artwork
 * (`public/logo.svg` is the same mark, for the README and any external use).
 * The brand lime is deliberately NOT a design token: tokens describe the app's
 * interface, and a logo that recoloured itself when the theme changed would
 * stop being a logo.
 */
export function Logo({
  className = "size-6",
  glow = true,
}: {
  className?: string;
  /** The ambient halo. Drop it at small sizes, where it just muddies the mark. */
  glow?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 160 160"
      className={className}
      role="img"
      aria-label="Jarvis"
      focusable="false"
    >
      {glow && (
        <>
          <defs>
            <radialGradient id="jv-glow" cx="50%" cy="50%" r="50%">
              <stop offset="35%" stopColor="#c6e315" stopOpacity="0.3" />
              <stop offset="70%" stopColor="#c6e315" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#c6e315" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="80" cy="80" r="78" fill="url(#jv-glow)" />
        </>
      )}
      <path d="M80 14 L27.5 80 L80 146 L49.5 80 Z" fill="#bedc04" />
      <path d="M80 14 L49.5 80 L80 146 Z" fill="#cbe817" />
      <path d="M80 14 L80 146 L110.5 80 Z" fill="#bedc04" />
      <path d="M80 14 L110.5 80 L80 146 L132.5 80 Z" fill="#acc705" />
    </svg>
  );
}
