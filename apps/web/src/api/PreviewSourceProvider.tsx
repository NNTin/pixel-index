import { type ReactNode, useEffect, useState } from 'react';

import { getMeta } from './client';
import { buildPreviewSource, fetchPreviewManifest, INACTIVE, type PreviewSource } from './previewSource';
import { PreviewSourceContext } from './previewSourceState';

export function PreviewSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<PreviewSource>(INACTIVE);

  useEffect(() => {
    // The controller is this effect's "am I still current?" flag, and the
    // signal reaches getMeta() but deliberately NOT fetchPreviewManifest().
    //
    // fetchPreviewManifest() memoises its promise at module scope for the
    // lifetime of the page (previewSource.ts). Aborting it would not cancel one
    // request, it would poison that cache: every later mount would await the
    // same rejected promise, the override would silently never arm, and every
    // card would fall back to the API's own image — precisely the failure the
    // candidate-preview mechanism exists to prevent, arriving silently.
    // StrictMode's mount/cleanup/remount would trigger it on the first page
    // load in development, every time.
    //
    // Not cancelling costs one small request that is already in flight and is
    // made once per page load, not once per component.
    const controller = new AbortController();
    const { signal } = controller;
    /**
     * Re-read the signal on every check, through a call.
     *
     * `AbortSignal.aborted` is a live getter, but lib.dom declares it
     * `readonly boolean` — and `readonly` is exactly what licenses TypeScript
     * to narrow a property path and keep that narrowing across an `await`. So
     * a second `if (signal.aborted)` after a first one reads as dead code even
     * though the intervening await is precisely when it changes. A call cannot
     * be narrowed, which is the honest encoding of "this value is live".
     */
    const superseded = () => signal.aborted;

    void (async () => {
      // On every deployment except a vendor-update preview this 404s, and that
      // is the end of it — `/meta` is only asked for once a manifest actually
      // exists, so production pays one small failed request per page load and
      // nothing else.
      const manifest = await fetchPreviewManifest();
      if (manifest === null || superseded()) return;

      const meta = await getMeta(signal).catch(() => null);
      // The catch above already swallowed an abort into `null`; this is what
      // stops that `null` being read as "the API has no pin".
      if (superseded()) return;

      setSource(buildPreviewSource(manifest, meta?.pixelAgents ?? null));
    })();

    return () => {
      controller.abort();
    };
  }, []);

  return <PreviewSourceContext value={source}>{children}</PreviewSourceContext>;
}
