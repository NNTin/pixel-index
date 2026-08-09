import { type ReactNode, useEffect, useState } from 'react';

import { getMeta } from './client';
import { buildPreviewSource, fetchPreviewManifest, INACTIVE, type PreviewSource } from './previewSource';
import { PreviewSourceContext } from './previewSourceState';

export function PreviewSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<PreviewSource>(INACTIVE);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // On every deployment except a vendor-update preview this 404s, and that
      // is the end of it — `/meta` is only asked for once a manifest actually
      // exists, so production pays one small failed request per page load and
      // nothing else.
      const manifest = await fetchPreviewManifest();
      if (manifest === null || cancelled) return;

      const meta = await getMeta().catch(() => null);
      if (cancelled) return;

      setSource(buildPreviewSource(manifest, meta?.pixelAgents ?? null));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <PreviewSourceContext value={source}>{children}</PreviewSourceContext>;
}
