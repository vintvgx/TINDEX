/**
 * Blends `tint` into `base` at `ratio` (0-1) and returns a fully opaque hex
 * color. Used for persistent background washes (e.g. paper/live mode tints)
 * that must render correctly wherever they're used — a semi-transparent
 * color (`tint + '0A'`) instead depends on whatever happens to be behind it,
 * which for an independent native Modal is the OS's own default backdrop,
 * not the app's theme. That's what silently ignored dark mode on the
 * immediate-trade confirm screen: the modal has no other opaque layer behind
 * it, so the "transparent" tint just showed the system default through.
 */
export function blendHex(base: string, tint: string, ratio: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  };
  const b = parse(base);
  const t = parse(tint);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * ratio);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(b.r, t.r))}${toHex(mix(b.g, t.g))}${toHex(mix(b.b, t.b))}`;
}
