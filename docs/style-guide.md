# Style guide

Pixel Index's color palette and interactive-element conventions. Source of truth for the
tokens is `apps/web/src/index.css` — this doc describes what's there, it doesn't define
new values, so if a value here and the CSS ever disagree, the CSS wins and this file
needs updating.

## Color palette

Every color is a CSS custom property defined twice in `apps/web/src/index.css` — once on
`:root` for light mode, once on `html[data-theme='dark']` for dark mode — then aliased to
a `--color-*` name in the `@theme inline` block that Tailwind classes actually consume
(e.g. `text-ink` resolves to `--color-ink`, which resolves to `--pi-ink`). Dark mode is
the app's default theme; light mode is the alternate.

| Token | Tailwind class(es) | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| `--pi-canvas` | `bg-canvas` | `#f7f6fb` | `#181828` | Page background |
| `--pi-surface` | `bg-surface` | `#ffffff` | `#1e1e2e` | Card / panel background |
| `--pi-surface-alt` | `bg-surface-alt` | `#efeaff` | `#20203a` | Secondary surface (menus, alt rows) |
| `--pi-border` | `border-border` | `#ddd6f3` | `#3c3c60` | Default border |
| `--pi-border-strong` | `border-border-strong` | `#c3b8ea` | `#505074` | Emphasized border |
| `--pi-ink` | `text-ink` | `#1c1830` | `#eeeef4` | Primary text |
| `--pi-muted` | `text-muted` | `#4a4570` | `#a8a8c4` | Secondary text |
| `--pi-subtle` | `text-subtle` | `#6b6598` | `#8888a8` | Tertiary / de-emphasized text |
| `--pi-accent` | `text-accent`, `border-accent`, `bg-accent` | `#6030ff` | `#9a8fff` | Brand accent |
| `--pi-accent-strong` | `text-accent-strong` | `#5028dd` | `#c0b5ff` | Emphasized accent (e.g. active filter chips) |
| `--pi-accent-solid-ink` | `text-accent-solid-ink` | `#ffffff` | `#16162a` | Text/icon color on a solid accent fill |
| `--pi-accent-soft` | `bg-accent-soft` | `rgb(96 48 255 / 8%)` | `rgb(154 143 255 / 16%)` | Accent-tinted background |
| `--pi-danger` | `text-danger`, `border-danger` | `#b3261e` | `#f87171` | Errors |
| `--pi-danger-strong` | `text-danger-strong` | `#8c1d17` | `#fca5a5` | Emphasized error |
| `--pi-danger-soft` | `bg-danger-soft` | `rgb(179 38 30 / 8%)` | `rgb(248 113 113 / 12%)` | Error-tinted background |
| `--pi-warning` | `text-warning`, `border-warning` | `#92620a` | `#fbbf24` | Warnings |
| `--pi-warning-strong` | `text-warning-strong` | `#714b05` | `#fcd34d` | Emphasized warning |
| `--pi-warning-soft` | `bg-warning-soft` | `rgb(146 98 10 / 10%)` | `rgb(251 191 36 / 12%)` | Warning-tinted background |

Accent is the Pixel Agents docs site's own brand purple (Docusaurus's `--ifm-color-primary*`
scale); canvas/surface are lifted verbatim from the office webview's own dark tones. Every
canvas/ink/muted pairing is checked against WCAG AA (4.5:1 for body text) — don't hand-pick
a new muted/subtle tone without checking contrast against both canvas and surface.

Never hardcode a hex value in a component. Always go through the Tailwind token classes
above (or the `--pi-*`/`--color-*` custom properties directly, for the rare case a Tailwind
utility doesn't exist) so both themes stay correct automatically.

## Interactive elements

Every element a user can click — link, button, or otherwise — must show `cursor: pointer`
on hover. Real `<a>`/`<Link>` elements get this from the browser for free; plain `<button>`
elements do not, and need `cursor-pointer` added explicitly.

**Exception:** `apps/web/src/components/FilterBar.tsx`'s controls (tag toggles, "Clear
filters", the sort/size/pets/furniture/seats inputs) intentionally keep their existing,
unaudited styling. Don't retrofit this guide onto FilterBar without a separate, deliberate
pass — filter behavior must stay exactly as-is.

### Button categories

Three button treatments exist in the codebase. Which one a button gets depends on one
question: **does clicking it keep the user on the current page, or does it forward them
somewhere else (another route, an OAuth redirect, an external site)?**

**a. Icon-only chrome controls** — logo/avatar links, the theme toggle, the anonymous
login glyph. No visible text, so `aria-label` and `title` are required. Border-less;
hover just recolors.

```text
text-ink hover:text-accent
```

(Add `cursor-pointer` if the element is a `<button>` rather than an `<a>`/`<Link>`.)

Example: `apps/web/src/components/Layout.tsx`'s `ThemeToggle`.

**b. Same-page / secondary actions** — the action keeps the user on the current page
(e.g. "Check preview", re-rendering an already-open form). Neutral border by default;
hover recolors the border to accent.

```text
cursor-pointer border-2 border-border px-4 py-2 text-sm text-ink hover:border-accent disabled:opacity-50
```

Example: `apps/web/src/routes/SubmitPage.tsx`'s "Check preview" button.

**c. Forward / external / state-changing actions** — the action navigates the user away
(a route change, an OAuth login redirect, an external link in a new tab) or otherwise
materially changes their situation (e.g. publishing a layout). Accent border and text from
the start; hover inverts to a filled accent background.

```text
cursor-pointer border-2 border-accent px-4 py-2 text-sm text-accent hover:bg-accent hover:text-accent-solid-ink disabled:opacity-50
```

Examples: `apps/web/src/routes/SubmitPage.tsx`'s "Publish" button; `apps/web/src/components/SubmissionGate.tsx`'s
"Log in with Discord" / "Reconnect Discord" buttons and "Join the Discord server" link —
login is an OAuth redirect-and-return flow and the invite opens an external site, so both
fall in bucket (c) despite one being a `<button>` and the other an `<a>`.
