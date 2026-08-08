import { useState } from 'react';

/**
 * Layouts are transparent outside the floor — without the checkered
 * backdrop they dissolve into the card (carried over verbatim from
 * `tools/build-site.mjs`'s `.shot` styling). `image-rendering: pixelated`
 * keeps the renderer's pixel art crisp instead of browser-smoothed. The
 * checker itself is drawn from the surface/surface-alt tokens so it tracks
 * the active theme instead of being pinned to one hardcoded pair.
 */
export function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="flex items-center justify-center bg-surface-alt bg-[length:16px_16px] bg-center p-3 [background-image:repeating-conic-gradient(var(--pi-canvas)_0%_25%,transparent_0%_50%)]"
    >
      {failed ? (
        <p className="py-12 text-center text-xs leading-relaxed text-subtle">no preview</p>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="h-auto w-full [image-rendering:pixelated]"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
