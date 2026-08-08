import { useState } from 'react';

/**
 * Layouts are transparent outside the floor. v1 used a checkered backdrop
 * (Photoshop-style "this is transparency") so the image wouldn't dissolve
 * into the card — replaced (#16 follow-up) with a plain `bg-canvas` fill
 * instead: the office itself never shows a transparency checker, its game
 * canvas is always an opaque solid colour, and a checker read as "not truly
 * transparent" against the office-matched palette rather than as the
 * intentional convention it was. `image-rendering: pixelated` keeps the
 * renderer's pixel art crisp instead of browser-smoothed.
 */
export function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex items-center justify-center bg-canvas p-3">
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
