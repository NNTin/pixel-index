import { usePreviewSource } from '../api/PreviewSourceContext';

function short(commit: string | null, version: string | null): string {
  if (commit) return commit.slice(0, 7);
  return version ?? 'unknown';
}

/**
 * Says out loud that the pictures on this page are not the ones the API would
 * serve.
 *
 * Not optional, and not dismissible. The point of swapping in the candidate
 * pin's renders (#26) is to let a reviewer see what a Pixel Agents bump does —
 * but a page that quietly shows different images than the API holds is just
 * lying in a new direction. The banner is what makes the swap honest.
 */
export function CandidatePinBanner() {
  const source = usePreviewSource();
  if (!source.active || source.manifest === null) return null;

  const { candidate, baseline } = source.manifest;

  return (
    <div
      role="status"
      className="border-b-2 border-accent bg-accent-soft px-6 py-2 text-sm text-ink"
    >
      Previews on this deployment are rendered against{' '}
      <strong>candidate Pixel Agents {short(candidate.commit, candidate.version)}</strong> — the API
      is still on {short(baseline.commit, baseline.version)}. Layouts the candidate cannot draw are
      marked rather than shown with their old image.
    </div>
  );
}
