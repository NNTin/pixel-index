import './DiscordLogo.css';

import { useId } from 'react';

/**
 * The animated Discord mark, in the `swirl` style (#66).
 *
 * Adapted from NNTin's own https://github.com/NNTin/discord-logo (MIT, © 2017
 * NNTin) — the generator behind https://nntin.xyz/discord-logo/#. Upstream is a
 * Vue app that builds the swirl layers imperatively in `updateAnimation()`;
 * since `swirl` is the one style this site wants (and upstream's default), the
 * three masked layers are written out statically here instead, and the Vue
 * `discordcolor`/`discordfill` props become inherited CSS in DiscordLogo.css.
 *
 * Deliberately inline JSX rather than an .svg file under public/: the swirl
 * needs page CSS to reach individual layers and the palette tokens to reach the
 * paths, and neither survives being loaded through an <img src>. Nothing is
 * fetched from nntin.xyz at runtime.
 *
 * Purely decorative — every caller so far wraps it in a link that carries the
 * accessible name, so this is hidden from assistive tech.
 */
export function DiscordLogo({ size = 32 }: { size?: number }) {
  // One instance per header today, but SVG ids are document-global: a second
  // instance would otherwise silently point every `use`/`mask` at the first.
  // React 19's useId is wrapped in «guillemets», stripped here so the ids stay
  // plain enough for both `href="#…"` and the `url(#…)` in a mask attribute.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const markId = `discord-mark-${uid}`;
  const maskId = (layer: string) => `discord-mask-${layer}-${uid}`;

  return (
    <svg
      className="discord-logo-container"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <g id={markId}>
          {/* Face: `currentColor`, so the mark takes the text color of wherever
              it is placed — text-ink alongside the header's other nav links. */}
          <path
            fill="currentColor"
            d="M40,12C40,12,35.415,8.412,30,8L29.512,8.976C34.408,10.174,36.654,11.891,39,14C34.955,11.935,30.961,10,24,10S13.045,11.935,9,14C11.346,11.891,14.018,9.985,18.488,8.976L18,8C12.319,8.537,8,12,8,12S2.879,19.425,2,34C7.162,39.953,15,40,15,40L16.639,37.815C13.857,36.848,10.715,35.121,8,32C11.238,34.45,16.125,37,24,37S36.762,34.45,40,32C37.285,35.121,34.143,36.848,31.361,37.815L33,40C33,40,40.838,39.953,46,34C45.121,19.425,40,12,40,12Z"
          />
          {/* Eyes: no `fill` attribute, so they inherit --color-canvas and read as cutouts. */}
          <path d="M17.5,30C15.567,30,14,28.209,14,26C14,23.791,15.567,22,17.5,22S21,23.791,21,26C21,28.209,19.433,30,17.5,30Z" />
          <path d="M30.5,30C28.567,30,27,28.209,27,26C27,23.791,28.567,22,30.5,22S34,23.791,34,26C34,28.209,32.433,30,30.5,30Z" />
        </g>

        {/* Concentric bands of the mark: everything outside 42%, the 32%–43% ring, the inner 32%. */}
        <mask id={maskId('outer')}>
          <rect width="100%" height="100%" fill="#FFFFFF" />
          <circle r="42%" cx="50%" cy="50%" fill="#000000" />
        </mask>
        <mask id={maskId('middle')}>
          <rect width="100%" height="100%" fill="#000000" />
          <circle r="43%" cx="50%" cy="50%" fill="#FFFFFF" />
          <circle r="32%" cx="50%" cy="50%" fill="#000000" />
        </mask>
        <mask id={maskId('inner')}>
          <rect width="100%" height="100%" fill="#000000" />
          <circle r="32%" cx="50%" cy="50%" fill="#FFFFFF" />
        </mask>
      </defs>

      <g className="discord-logo">
        {/* At rest only this copy is visible; on hover it hides and the bands swirl apart. */}
        <use className="discord-original" href={`#${markId}`} />
        <use className="discord-inner-layer" href={`#${markId}`} mask={`url(#${maskId('inner')})`} />
        <use className="discord-middle-layer" href={`#${markId}`} mask={`url(#${maskId('middle')})`} />
        <use className="discord-outer-layer" href={`#${markId}`} mask={`url(#${maskId('outer')})`} />
      </g>
    </svg>
  );
}
