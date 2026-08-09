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
 * stale beats a static one that is certainly stale, and a container without
 * `PIXEL_AGENTS_COMMIT` set reports `commit: null` (see the API's meta.ts), so
 * this is a real configuration, not a hypothetical.
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
  /** Absolute, trailing slash. Layout files resolve against it. */
  baseUrl: string;
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
      // A layout the manifest has never heard of is one submitted after the
      // gate ran. The API's image is the honest answer there — it is not
      // "broken under the candidate", it is simply unmeasured.
      if (entry === undefined) return { kind: 'api' };
      if ('failed' in entry) return { kind: 'failed', reason: entry.failed };
      return { kind: 'candidate', src: `${manifest.baseUrl}${entry.file}` };
    },
  };
}

/**
 * Fetched once per page load, not per component.
 *
 * A 404 is the overwhelmingly common case — every deployment except a
 * vendor-update preview — so this must be cheap and completely silent when the
 * file is not there.
 */
let cached: Promise<PreviewManifest | null> | null = null;

export function fetchPreviewManifest(): Promise<PreviewManifest | null> {
  cached ??= (async () => {
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
