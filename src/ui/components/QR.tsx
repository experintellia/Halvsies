// Renders a QR code from a payload string as an inline <svg> (crisper and
// scales without blur, unlike the library's own table/img output).
import { useMemo } from "preact/hooks";
import * as qrcodeImport from "qrcode-generator";

interface QRCodeInstance {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
type QRCodeFactory = (
  typeNumber: number,
  errorCorrectionLevel: "L" | "M" | "Q" | "H",
) => QRCodeInstance;

// qrcode-generator's shipped .d.ts describes a CommonJS `export =`, but the
// ESM build Vite actually resolves at runtime (dist/qrcode.mjs) has a real
// `export default` — so `import * as qrcodeImport` yields `{ default: fn }`
// at runtime despite what the types claim. Grab whichever shape shows up.
const qrcodeFactory: QRCodeFactory =
  (qrcodeImport as unknown as { default?: QRCodeFactory }).default ??
  (qrcodeImport as unknown as QRCodeFactory);

export interface QRProps {
  payload: string;
  /** rendered width/height in px, default 180 */
  size?: number;
}

/** Builds the dark/light module grid, or null if `payload` is too long for
 *  any QR version at error-correction level M. */
function buildMatrix(payload: string): boolean[][] | null {
  try {
    const qr = qrcodeFactory(0, "M"); // 0 = auto-pick the smallest version
    qr.addData(payload);
    qr.make();
    const n = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

export function QR({ payload, size = 180 }: QRProps) {
  const matrix = useMemo(() => buildMatrix(payload), [payload]);

  if (!matrix) {
    return (
      <p className="qr-fallback" role="note">
        This payment code is too long to show as a QR code — use copy or
        send-to-chat instead.
      </p>
    );
  }

  const n = matrix.length;
  const quiet = 4; // modules of white margin, per the QR spec's quiet zone
  const dim = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) path += `M${c + quiet},${r + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label="Payment QR code"
    >
      <title>Scan with a banking or payment app to pay</title>
      <rect width={dim} height={dim} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
