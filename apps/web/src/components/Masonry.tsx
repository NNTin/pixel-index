import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { computeColumnCount, layoutMasonry } from './masonry';

/** Every card renders at this width; only height is ever content-driven. */
const CARD_WIDTH = 280;
/** Matches the row-based layout's old `gap-6` (1.5rem), both horizontally and vertically. */
const GAP = 24;
/**
 * Used only for a card that hasn't reported a real height yet, so its column
 * has *something* to compare against on the very first placement pass. Once
 * its ResizeObserver fires, the real height replaces this and the layout
 * recomputes — see `measured` below, which keeps the card invisible until
 * that happens so nobody sees it parked at the wrong height.
 */
const ESTIMATED_HEIGHT = 360;

/**
 * True masonry: fixed card width, independently dynamic height, each card
 * placed in the shortest column so far (#46) — not CSS `columns: N`, which
 * fills one column top-to-bottom before the next (newspaper z-order, not
 * shortest-column) and relayouts every card whenever the item count changes.
 *
 * Cards render in `items` order in the DOM — visual column position comes
 * entirely from a CSS `transform`, not from moving elements into per-column
 * containers — so tab order and screen-reader order follow the data, not the
 * columns.
 */
export function Masonry<T>({
  items,
  keyFor,
  renderItem,
  className,
}: {
  items: readonly T[];
  keyFor: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLUListElement | null>(null);
  const itemObserverRef = useRef<ResizeObserver | null>(null);
  const nodesByKeyRef = useRef(new Map<string, HTMLLIElement>());

  // A container width is unknowable before the first layout, but waiting for
  // it would flash a single column on every load. The viewport width is a
  // reasonable stand-in for a full-bleed gallery; the ResizeObserver below
  // corrects it to the real container width as soon as it fires (usually
  // before the next paint), trading a possible one-frame column-count
  // mismatch for never rendering a forced single column.
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === 'undefined' ? CARD_WIDTH : window.innerWidth,
  );
  // Measured per-card heights, read during render (by the layout memo and by
  // the "hide until measured" check below) — so, unlike the DOM/observer
  // bookkeeping above, this has to be state rather than a ref: React data-flow
  // rules require values read during render to come from state or props, not
  // a ref's mutable `.current`.
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setContainerWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const updates = new Map<string, number>();
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.masonryKey;
        const measured = entry.contentRect.height;
        if (key === undefined || measured <= 0) continue;
        updates.set(key, measured);
      }
      if (updates.size === 0) return;
      setHeights((current) => {
        let changed = false;
        for (const [key, value] of updates) {
          if (current.get(key) !== value) changed = true;
        }
        if (!changed) return current;
        return new Map([...current, ...updates]);
      });
    });
    itemObserverRef.current = observer;
    for (const node of nodesByKeyRef.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // One stable callback shared by every card (rather than one memoized per
  // key, cached in a ref) — reading that cache back out during render is
  // exactly the ref-during-render access React's data-flow rules forbid.
  // The card's own key travels via its `data-masonry-key` attribute instead
  // of a closure, so identity here never needs to change.
  const handleItemRef = useCallback((node: HTMLLIElement | null) => {
    if (!node) return;
    const key = node.dataset.masonryKey;
    if (key === undefined) return;
    nodesByKeyRef.current.set(key, node);
    itemObserverRef.current?.observe(node);
    return () => {
      nodesByKeyRef.current.delete(key);
      itemObserverRef.current?.unobserve(node);
    };
  }, []);

  const columnCount = useMemo(() => computeColumnCount(containerWidth, CARD_WIDTH, GAP), [containerWidth]);
  const keys = useMemo(() => items.map(keyFor), [items, keyFor]);

  const { positions, height } = useMemo(
    () => layoutMasonry(keys, heights, columnCount, CARD_WIDTH, GAP, ESTIMATED_HEIGHT),
    [keys, heights, columnCount],
  );

  return (
    <ul ref={containerRef} className={className} style={{ position: 'relative', height }}>
      {items.map((item) => {
        const key = keyFor(item);
        const position = positions.get(key);
        const measured = heights.has(key);
        return (
          <li
            key={key}
            ref={handleItemRef}
            data-masonry-key={key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CARD_WIDTH,
              transform: `translate(${position?.left ?? 0}px, ${position?.top ?? 0}px)`,
              opacity: measured ? 1 : 0,
              transition: 'transform 150ms ease, opacity 150ms ease',
            }}
          >
            {renderItem(item)}
          </li>
        );
      })}
    </ul>
  );
}
