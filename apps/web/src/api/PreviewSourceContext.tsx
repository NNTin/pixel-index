import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { apiUrl, getMeta } from './client';
import {
  buildPreviewSource,
  fetchPreviewManifest,
  INACTIVE,
  type PreviewSource,
} from './previewSource';

/**
 * Resolved once for the whole app, not once per card.
 *
 * A gallery page renders 24 `LayoutCard`s; each of them asking independently
 * whether previews are overridden would mean 24 `/api/v1/meta` calls to answer
 * one question that cannot differ between them.
 *
 * Unlike `useTheme`, the hook does **not** throw without a provider — it
 * returns `INACTIVE`, which is both the correct production default (no
 * manifest, no override) and what lets a component test render a card without
 * wiring up machinery that has nothing to do with what it is testing.
 */
const PreviewSourceContext = createContext<PreviewSource>(INACTIVE);

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

export function usePreviewSource(): PreviewSource {
  return useContext(PreviewSourceContext);
}

export interface PreviewImageProps {
  src: string;
  unavailable?: string;
}

/**
 * The props `PreviewImage` needs for one layout — normally the API's own URL,
 * and the candidate pin's render when a vendor-update preview is active.
 *
 * `apiPath` is the API-relative path from `LayoutSummary.files`; turning that
 * into something an `<img src>` can use stays `apiUrl`'s job (client.ts).
 *
 * Not a hook, so a component that only has the layout *after* an early return
 * for its loading and error states can still use it (LayoutDetailPage).
 */
export function previewImageProps(
  source: PreviewSource,
  slug: string,
  apiPath: string,
): PreviewImageProps {
  const resolution = source.resolve(slug);

  switch (resolution.kind) {
    case 'candidate':
      return { src: resolution.src };
    case 'failed':
      return {
        src: '',
        unavailable: `does not render under the candidate Pixel Agents (${resolution.reason})`,
      };
    case 'api':
      return { src: apiUrl(apiPath) };
  }
}

/** `previewImageProps` for a component that has its layout up front. */
export function usePreviewImage(slug: string, apiPath: string): PreviewImageProps {
  return previewImageProps(usePreviewSource(), slug, apiPath);
}
