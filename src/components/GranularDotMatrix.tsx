import React, { useEffect, useRef } from 'react';

interface GranularDotMatrixProps {
  /** Grid cell pitch in CSS pixels */
  pitch?: number;
  /** Vertical start fraction of the transition zone (0..1) */
  bandStart?: number;
  /** Vertical end fraction of the transition zone (0..1) */
  bandEnd?: number;
  /** Optional className for outer canvas */
  className?: string;
}

/**
 * Renders crisp matte-black micro-squares strictly inside the color-transition
 * band of a tile (leaving solid dark upper & solid colored bottom zones clean).
 * Squares are larger near the uncolored upper side of the transition band and
 * progressively shrink toward the vibrant colored bottom.
 */
export const GranularDotMatrix: React.FC<GranularDotMatrixProps> = ({
  pitch = 8.5,
  bandStart = 0.44,
  bandEnd = 0.86,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w <= 0 || h <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const isDark = document.documentElement.classList.contains('dark');
      ctx.fillStyle = isDark ? 'rgba(3, 4, 8, 0.92)' : 'rgba(15, 20, 30, 0.16)';

      const yStart = h * bandStart;
      const yEnd = h * bandEnd;
      const bandSpan = Math.max(1, yEnd - yStart);

      const maxSize = Math.min(5.6, pitch * 0.66);
      const minSize = 1.25;

      let rowIndex = 0;
      for (let y = yStart + pitch * 0.35; y <= yEnd - pitch * 0.2; y += pitch) {
        // u = 0 near dark uncolored edge (larger squares), u = 1 near vibrant colored edge (smaller squares)
        const u = Math.max(0, Math.min(1, (y - yStart) / bandSpan));
        const size = minSize + (maxSize - minSize) * Math.pow(1 - u, 1.2);
        const half = size / 2;
        const xOffset = rowIndex % 2 === 0 ? pitch * 0.5 : pitch;

        for (let x = xOffset; x <= w - pitch * 0.35; x += pitch) {
          ctx.fillRect(Math.round(x - half), Math.round(y - half), size, size);
        }
        rowIndex += 1;
      }
    };

    draw();

    const ro = new ResizeObserver(() => draw());
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }

    const mo = new MutationObserver(() => draw());
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [pitch, bandStart, bandEnd]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 h-full w-full rounded-[inherit] ${className}`}
    />
  );
};
