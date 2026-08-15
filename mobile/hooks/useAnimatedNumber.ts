import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly counts from the previous displayed value to `target` whenever it
 * changes — the first time a null target resolves to a real number, it
 * counts up from 0 rather than snapping in, giving live stats (VIX, market
 * tile prices) a "ticking" reveal as data arrives instead of popping in.
 */
export function useAnimatedNumber(target: number | null, duration = 1400): number | null {
  const [display, setDisplay] = useState<number | null>(null);
  const prevTargetRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) return;

    const from = prevTargetRef.current ?? 0;
    const diff = target - from;
    const start = Date.now();

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDisplay(from + diff * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        prevTargetRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}
