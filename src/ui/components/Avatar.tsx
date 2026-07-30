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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
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
