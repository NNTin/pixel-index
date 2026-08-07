import { useState } from 'react';

/**
 * Layouts are transparent outside the floor — without the checkered
 * backdrop they dissolve into the card (carried over verbatim from
 * `tools/build-site.mjs`'s `.shot` styling). `image-rendering: pixelated`
 * keeps the renderer's pixel art crisp instead of browser-smoothed.
 */
export function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="flex items-center justify-center p-3"
      style={{
        background: 'repeating-conic-gradient(#191926 0% 25%, #15151f 0% 50%) 50% / 16px 16px',
      }}
    >
      {failed ? (
        <p className="py-12 text-center text-xs leading-relaxed text-slate-500">no preview</p>
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
