// The app icon's split circle, for empty states: two halves joined along the
// zigzag seam. Colours come from CSS (.split-mark .l/.r/.seam) so it follows
// the theme.
const SEAM: ReadonlyArray<readonly [number, number]> = [
  [50, 8],
  [46, 14],
  [54, 22],
  [46, 30],
  [54, 38],
  [46, 46],
  [54, 54],
  [46, 62],
  [54, 70],
  [46, 78],
  [54, 86],
  [50, 92],
];
const seam = "M" + SEAM.map((p) => p.join(" ")).join(" L");
// Walks the seam back up from the bottom, closing each half along it.
const back = SEAM.slice(1, -1)
  .reverse()
  .map((p) => "L" + p.join(" "))
  .join(" ");

export function SplitMark({ size = 104 }: { size?: number }) {
  return (
    <svg
      className="split-mark"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <path className="l" d={`M50 8 A42 42 0 0 0 50 92 ${back} Z`} />
      <path className="r" d={`M50 8 A42 42 0 0 1 50 92 ${back} Z`} />
      <path className="seam" d={seam} />
    </svg>
  );
}
