import React, { useCallback, useRef, useState } from 'react';

interface UseGridDragReorderOptions<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (nextItems: T[]) => void;
}

export function useGridDragReorder<T>({
  items,
  getId,
  onReorder,
}: UseGridDragReorderOptions<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const lastSwapAtRef = useRef<number>(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const stopDragging = useCallback(() => {
    draggingIdRef.current = null;
    setDraggingId(null);
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const activeId = draggingIdRef.current;
      if (!activeId) return;

      const now = Date.now();
      // Cooldown prevents oscillation when uneven 1x1 and 2x1 tiles swap
      if (now - lastSwapAtRef.current < 160) return;

      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      let targetId: string | null = null;
      for (const el of elements) {
        const tileEl = (el as HTMLElement).closest?.('[data-drag-tile-id]') as HTMLElement | null;
        if (tileEl) {
          const found = tileEl.getAttribute('data-drag-tile-id');
          if (found && found !== activeId) {
            targetId = found;
            break;
          }
        }
      }

      if (!targetId) return;

      const current = itemsRef.current;
      const fromIndex = current.findIndex((item) => getId(item) === activeId);
      const toIndex = current.findIndex((item) => getId(item) === targetId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      lastSwapAtRef.current = now;
      onReorder(next);
    },
    [getId, onReorder]
  );

  const startDrag = useCallback(
    (id: string, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingIdRef.current = id;
      setDraggingId(id);

      const onMove = (ev: PointerEvent) => handlePointerMove(ev);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        stopDragging();
      };

      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [handlePointerMove, stopDragging]
  );

  return {
    draggingId,
    startDrag,
  };
}
