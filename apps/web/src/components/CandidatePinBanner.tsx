import { usePreviewSource } from '../api/PreviewSourceContext';
import type { PreviewManifest } from '../api/previewSource';

function short(commit: string | null, version: string | null): string {
  if (commit) return commit.slice(0, 7);
  return version ?? 'unknown';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What this deployment is actually showing, in one sentence.
 *
 * The wording has to track what was published, because only *some* previews
 * here are candidate renders. A layout that renders identically under both pins
 * is served by the API — and that is not a compromise: renders are
 * deterministic, so the API's image and the candidate's are the same bytes.
 * Saying "previews are rendered against the candidate" when three cards out of
 * two hundred are would be its own kind of lie, which is the thing this banner
 * exists to prevent.
 */
function message(manifest: PreviewManifest): string {
  const candidate = short(manifest.candidate.commit, manifest.candidate.version);
  const baseline = short(manifest.baseline.commit, manifest.baseline.version);
  const capped = manifest.changed + manifest.failed > manifest.shown;

  if (manifest.changed === 0 && manifest.failed === 0) {
    return (
      `Candidate Pixel Agents ${candidate} draws every layout exactly as the API's ` +
      `${baseline} does — nothing changed visually, so every preview here is the API's own image.`
    );
  }

  const parts: string[] = [];

  if (capped) {
    // The count is the point. A sample that does not admit to being one invites
    // the reader to conclude the other 750 were fine.
    parts.push(
      `${plural(manifest.changed, 'layout')} render differently under candidate Pixel Agents ` +
        `${candidate} — too many to show. A sample of ${manifest.shown} is displayed here; ` +
        `the rest keep the API's current images.`,
    );
  } else {
    parts.push(
      `${plural(manifest.changed, 'layout')} render differently under candidate Pixel Agents ` +
        `${candidate} and ${manifest.changed === 1 ? 'is' : 'are'} shown here. ` +
        `The API is still on ${baseline}; every other preview is its image, which is ` +
        `byte-identical to what the candidate draws.`,
    );
  }

  if (manifest.failed > 0) {
    parts.push(
      `${plural(manifest.failed, 'layout')} cannot be drawn by the candidate at all and ` +
        `${manifest.failed === 1 ? 'is' : 'are'} marked rather than shown with an old image.`,
    );
  }

  return parts.join(' ');
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
