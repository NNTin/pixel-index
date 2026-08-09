/**
 * Where a layout's preview picture comes from — and why it is not always the
 * API.
 *
 * A vendor-update PR (#26) changes the pinned Pixel Agents. But this app's
 * preview deployment still calls the *production* API, whose renderer runs the
 * **old** pin — so without this module, a reviewer opening the preview of a
 * Pixel Agents bump sees thumbnails drawn by exactly the vendor the PR is
 * replacing. The one view where seeing the difference matters is the one view
 * that cannot show it.
 *
 * The vendor-update workflow has already rendered every layout against the
 * candidate pin (that is how it produced its verdict), published those PNGs,
 * and committed a manifest pointing at them. This reads that manifest.
 *
 * ## It disarms itself
 *
 * The manifest is committed to the PR branch, which means it is *merged* along
 * with the pin — so it will exist on `main` and in production, long after it
 * stops describing anything real. Rather than needing a cleanup commit nobody
 * would remember to make, the override only applies while the API is
 * demonstrably on a *different* pin than the manifest was rendered against.
 * Once the PR merges and the API redeploys onto the candidate pin, the two
 * agree and previews come from the API again.
 *
 * The comparison fails **safe**: if the API does not report a pin it can be
 * compared on, the override stays off. A live image that might be slightly
 * stale beats a static one that is certainly stale. A current API always
 * reports its commit — the pin ships as a file in the image — but one built
 * before that answers `commit: null`, so this is a real state to handle rather
 * than a hypothetical.
 */

/**
 * ## The manifest shape is declared twice, deliberately
 *
 * The producer's copy is `services/renderer/src/harness/manifest.ts`. This is a
 * *wire format* — a JSON file published by one workspace and fetched by
 * another — so the two ends mirror each other exactly the way `types.ts` here
 * already mirrors the API's `serialize.ts`. Sharing the type would mean giving
 * the browser bundle a dependency on a Node-only package (`fs`, `child_process`,
 * ajv) to import an interface. Change one end, change the other.
 */
export interface PreviewManifestPin {
  commit: string | null;
  version: string | null;
}

export interface PreviewManifest {
  generatedAt: string;
  candidate: PreviewManifestPin;
  baseline: PreviewManifestPin;
  /**
   * The upstream repository, so a pin can link to the commit it names. From
   * `.gitmodules` via the workflow, so a fork links to its own upstream.
   * `null` when it could not be read — the banner then shows the short sha as
   * plain text rather than a link to nowhere.
   */
  upstreamUrl: string | null;
  /**
   * Totals for the whole index, not for `layouts` — which holds at most `cap`
   * of them. The page has to be able to say "800 changed, here are 50" rather
   * than showing 50 and letting a reader assume that was all of them.
   */
  changed: number;
  failed: number;
  shown: number;
  cap: number;
  /**
   * Only layouts that render *differently* under the candidate, or fail on it.
   * Everything else is absent on purpose: renders are deterministic, so a
   * layout that renders identically is already being served correctly by the
   * API and needs nothing published.
   */
  layouts: Record<string, { file: string } | { failed: string }>;
}

/** What a component should draw for one layout. */
export type PreviewResolution =
  /** Use the API, as normal. */
  | { kind: 'api' }
  /** Use this URL instead — rendered against the candidate pin. */
  | { kind: 'candidate'; src: string }
  /**
   * The candidate pin cannot draw this layout at all. Deliberately NOT a
   * fallback to the API's image: showing the old picture where the new pin
   * draws nothing is precisely the lie this whole mechanism exists to stop.
   */
  | { kind: 'failed'; reason: string };

export interface PreviewSource {
  active: boolean;
  manifest: PreviewManifest | null;
  resolve(slug: string): PreviewResolution;
}

export const INACTIVE: PreviewSource = {
  active: false,
  manifest: null,
  resolve: () => ({ kind: 'api' }),
};

/**
 * True when the API is demonstrably on a different pin than the manifest.
 *
 * Commit first — it is exact. Version only as a fallback, because the pin is
 * routinely several commits past a tag (`v1.4.0-14-g9794e07`), so two different
 * pins can share a version and comparing on it alone would disarm the override
 * on a bump that never changed the version number.
 */
export function shouldOverride(
  manifest: PreviewManifest,
  apiPin: { commit: string | null; version: string | null } | null,
): boolean {
  if (apiPin === null) return false;
  if (manifest.candidate.commit !== null && apiPin.commit !== null) {
    return manifest.candidate.commit !== apiPin.commit;
  }
  if (manifest.candidate.version !== null && apiPin.version !== null) {
    return manifest.candidate.version !== apiPin.version;
  }
  return false;
}

export function buildPreviewSource(
  manifest: PreviewManifest,
  apiPin: { commit: string | null; version: string | null } | null,
): PreviewSource {
  if (!shouldOverride(manifest, apiPin)) return INACTIVE;

  return {
    active: true,
    manifest,
    resolve(slug) {
      const entry = manifest.layouts[slug];
      // Absent means one of three things, and the API's image is the right
      // answer to all of them: the candidate renders it identically (so that
      // image *is* the candidate's render), it was submitted after the gate
      // ran and is simply unmeasured, or it changed but fell outside the cap —
      // which the banner says out loud rather than leaving to be inferred.
      if (entry === undefined) return { kind: 'api' };
      if ('failed' in entry) return { kind: 'failed', reason: entry.failed };
      return { kind: 'candidate', src: previewAssetUrl(entry.file) };
    },
  };
}

/**
 * Where the candidate renders are served from: this deployment itself.
 *
 * The build downloads them into `dist/vendor-preview/` (vite.config.ts), so
 * they come off the same origin and the same CDN as everything else — visitors
 * never reach `raw.githubusercontent.com`, which is neither a CDN nor
 * comfortable being used as one.
 */
function previewAssetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}vendor-preview/${file}`;
}

/**
 * Fetched once per page load, not per component.
 *
 * A 404 is the overwhelmingly common case — every deployment except a
 * vendor-update preview — so this must be cheap and completely silent when the
 * file is not there. On a production build the file cannot exist at all: it is
 * no longer committed anywhere, and only a preview build fetches it.
 */
let cached: Promise<PreviewManifest | null> | null = null;

export function fetchPreviewManifest(): Promise<PreviewManifest | null> {
  cached ??= (async () => {
    // Redundant with the build, which never writes the file outside a preview
    // — kept because the failure this replaces was exactly a manifest reaching
    // production, and one cheap constant means that cannot recur even if the
    // file finds its way back into `public/`.
    if (!__VENDOR_PREVIEW__) return null;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}vendor-preview/manifest.json`, {
        cache: 'no-cache',
      });
      if (!response.ok) return null;
      return (await response.json()) as PreviewManifest;
    } catch {
      // Offline, or a dev server answering the SPA fallback HTML for a missing
      // file. Either way: no override, and nothing worth telling the user.
      return null;
    }
  })();
  return cached;
}

/** Tests only — the module-level cache would otherwise leak between them. */
export function resetPreviewManifestCache(): void {
  cached = null;
}
