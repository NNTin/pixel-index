import type { ReactNode } from 'react';

import type { PreviewManifest, PreviewManifestPin } from '../api/previewSource';
import { usePreviewSource } from '../api/previewSourceState';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A pin as the reader wants it: seven characters, linked to the commit itself.
 *
 * The short sha is the only identifier in this banner, and on its own it is
 * unactionable — the question it provokes is always "what actually changed
 * upstream?", which is one click away. `upstreamUrl` comes from `.gitmodules`
 * via the manifest, so a fork links to its own upstream. Falls back to plain
 * text when the commit or the URL is unknown, rather than linking to nowhere.
 */
function Pin({ pin, upstreamUrl }: { pin: PreviewManifestPin; upstreamUrl: string | null }) {
  const label = pin.commit ? pin.commit.slice(0, 7) : (pin.version ?? 'unknown');
  if (!pin.commit || !upstreamUrl) return <>{label}</>;

  return (
    <a
      href={`${upstreamUrl}/commit/${pin.commit}`}
      className="text-accent underline"
      target="_blank"
      rel="noreferrer"
      title={pin.commit}
    >
      {label}
    </a>
  );
}

/**
 * What this deployment is actually showing, in one sentence.
 *
 * The wording has to track what was published, because only *some* previews
 * here are candidate renders — most weeks, none are. A layout that renders
 * identically under both pins is served by the API, and that is not a
 * compromise: renders are deterministic, so the API's image and the
 * candidate's are the same bytes. Claiming "previews are rendered against the
 * candidate" when three cards out of two hundred are would be its own kind of
 * lie, which is the thing this banner exists to prevent.
 */
function message(manifest: PreviewManifest): ReactNode {
  const { upstreamUrl } = manifest;
  const candidate = <Pin pin={manifest.candidate} upstreamUrl={upstreamUrl} />;
  const baseline = <Pin pin={manifest.baseline} upstreamUrl={upstreamUrl} />;
  const capped = manifest.changed + manifest.failed > manifest.shown;

  const failures = manifest.failed > 0 && (
    <>
      {' '}
      {plural(manifest.failed, 'layout')} cannot be drawn by the candidate at all and{' '}
      {manifest.failed === 1 ? 'is' : 'are'} marked rather than shown with an old image.
    </>
  );

  if (manifest.changed === 0 && manifest.failed === 0) {
    return (
      <>
        Candidate Pixel Agents {candidate} draws every layout exactly as the API's{' '}
        {baseline} does — nothing changed visually, so every preview here is the API's own
        image.
      </>
    );
  }

  if (capped) {
    // The count is the point. A sample that does not admit to being one invites
    // the reader to conclude the other 750 were fine.
    return (
      <>
        {plural(manifest.changed, 'layout')} render differently under candidate Pixel Agents{' '}
        {candidate} — too many to show. A sample of {manifest.shown} is displayed here; the rest
        keep the API's current images ({baseline}).{failures}
      </>
    );
  }

  return (
    <>
      {plural(manifest.changed, 'layout')} render differently under candidate Pixel Agents{' '}
      {candidate} and {manifest.changed === 1 ? 'is' : 'are'} shown here. The API is still on{' '}
      {baseline}; every other preview is its image, which is byte-identical to what the candidate
      draws.{failures}
    </>
  );
}

/**
 * Says out loud that some pictures on this page are not the ones the API would
 * serve. Not optional and not dismissible: swapping images in silently would
 * only be lying in a new direction.
 */
export function CandidatePinBanner() {
  const source = usePreviewSource();
  if (!source.active || source.manifest === null) return null;

  return (
    <div
      role="status"
      className="border-b-2 border-accent bg-accent-soft px-6 py-2 text-sm text-ink"
    >
      {message(source.manifest)}
    </div>
  );
}
