// Initials-in-a-circle. Colour is a deterministic hash of the member id (not
// random), so every peer renders the same avatar colour for the same member.
import type { Member } from "../../state/model";

export interface AvatarProps {
  member: Pick<Member, "id" | "name">;
  /** diameter in px, default 32 */
  size?: number;
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

// First grapheme, not first UTF-16 unit: "🏰"[0] is half a surrogate pair.
// Intl.Segmenter keeps ZWJ emoji and flags whole; code points are the fallback
// for engines without it (Firefox < 125).
const Segmenter = (
  Intl as {
    Segmenter?: new () => { segment(s: string): Iterable<{ segment: string }> };
  }
).Segmenter;

function firstGrapheme(s: string): string {
  if (Segmenter)
    for (const { segment } of new Segmenter().segment(s)) return segment;
  return Array.from(s)[0] ?? "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = firstGrapheme(parts[0]);
  const last = parts.length > 1 ? firstGrapheme(parts[parts.length - 1]) : "";
  return (first + last).toUpperCase();
}

export function Avatar({ member, size = 32 }: AvatarProps) {
  const hue = hashHue(member.id);
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${Math.max(10, Math.round(size * 0.4))}px`,
    background: `hsl(${hue}, 55%, 42%)`,
  };
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(member.name)}
    </span>
  );
}
