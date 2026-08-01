// Inline SVG icons.
//
// The glyphs are copied verbatim from **Lucide** (https://lucide.dev), which is
// ISC-licensed — permissive and attribution-free, unlike Font Awesome Free
// (CC BY 4.0, which would oblige us to carry an attribution notice). See
// LICENSE-THIRD-PARTY.md. `lucide-static` is a devDependency purely as the
// provenance of these paths: nothing from it reaches the bundle, and adding an
// icon means copying one more entry out of `node_modules/lucide-static/icons/`.
//
// Inlined rather than imported as files because a webxdc app has no network and
// every extra asset is another entry in the .xdc zip; five path strings cost
// well under a kilobyte. Emoji were the previous stand-in and rendered as three
// different pictures on three platforms — and at wildly different optical
// weights next to a text label.
import type { JSX } from "preact";

export type IconName =
  "receipt" | "scale" | "user" | "check" | "close" | "chevron-left";

/** Icon geometry only: everything else (stroke, size) comes from <Icon>. */
const ICONS: Record<IconName, JSX.Element> = {
  // lucide/receipt
  receipt: (
    <>
      <path d="M12 17V7" />
      <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" />
      <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />
    </>
  ),
  // lucide/scale
  scale: (
    <>
      <path d="M12 3v18" />
      <path d="m19 8 3 8a5 5 0 0 1-6 0zV7" />
      <path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" />
      <path d="m5 8 3 8a5 5 0 0 1-6 0zV7" />
      <path d="M7 21h10" />
    </>
  ),
  // lucide/circle-user
  user: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
    </>
  ),
  // lucide/check
  check: <path d="M20 6 9 17l-5-5" />,
  // lucide/x
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  // lucide/chevron-left
  "chevron-left": <path d="m15 18-6-6 6-6" />,
};

export interface IconProps {
  name: IconName;
  /** Square edge in px. Defaults to 1em so it tracks the surrounding text. */
  size?: number | string;
  /** Stroke width in the 24×24 viewBox; thinner reads better when scaled up. */
  strokeWidth?: number;
}

export function Icon({ name, size = "1em", strokeWidth = 2 }: IconProps) {
  return (
    <svg
      className="icon"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      // Decorative in every current use: each icon sits next to a text label
      // or on a button that already carries an aria-label.
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
