# Contributing a layout

## Publish through the site (primary path)

1. Design your office in Pixel Agents, then **Layout → Export** to get a `layout.json`.
2. Open the site, log in with Discord, and go to **Submit**.
3. Paste or upload the `layout.json`, fill in a title, description and tags, then
   **Check preview** — you'll see your office rendered exactly as everyone else will,
   before anyone else can. Read [CONTENT_POLICY.md](CONTENT_POLICY.md) first; the submit
   page links it for the same reason.
4. **Publish.** It's public immediately — this index is post-moderated, not
   reviewed-before-publish (see the policy for what that means and how to report
   something that shouldn't be there).

Once published, it's yours: **My layouts** lets you edit the title/description/tags,
replace the `layout.json` (if you re-export from a newer Pixel Agents, say), or delete
it, at any time — no pull request needed for any of that either.

### What gets checked, and why

- `cols × rows` matches the number of tiles.
- Every furniture id exists in the pinned Pixel Agents — an export from a newer version
  can reference furniture this index cannot yet draw.
- `layoutRevision` is not below the bundled default's. Pixel Agents **discards a stored
  layout whose `layoutRevision` is lower than the bundled default's** and resets it to
  the default office (`server/src/layoutPersistence.ts`) — publishing one that would be
  silently wiped on a user's next start helps nobody, so this is rejected with an
  explanation of why, not just a bare error.

### Do not edit `layout.json` by hand

It is the artifact people download and import, byte-for-byte. Keep it exactly as Pixel
Agents exported it; everything descriptive (title, description, tags) travels alongside
it, never inside it.

## Proposing a seed layout (pull request)

The handful of layouts the index ships with by default — so a fresh install is never an
empty page — are git-versioned in `seed/` and loaded into the database on first boot
([#18](https://github.com/pixel-agents-hq/pixel-index/issues/18)), rather than living only in the
database. Proposing a *new* seed layout, or a fix to an existing one, is still a pull
request:

```bash
git submodule update --init --recursive
npm ci
npm run validate
```

CI runs the same validation the live submit flow does, so a seed layout can never be one
the site would itself reject. This path is specifically for the curated starter set —
publishing your own layout for the community index is the web flow above.

## Editing the docs

Markdown is also linted and checked in CI — run all of it locally with:

```bash
npm run lint:md        # style: headings, fenced-code languages, bare URLs, …
npm run check:links    # every relative link between markdown files still resolves
npm run check:mermaid  # every mermaid diagram still parses
```

`lint:md` is [markdownlint](https://github.com/DavidAnson/markdownlint) with two
house-style exceptions recorded in [`.markdownlint.json`](../.markdownlint.json): line
length is unenforced (this repo writes flowing prose, not hard-wrapped columns), and
table pipe spacing only has to agree with itself, not with a fixed style.

`check:links` is [`tools/check-links.mjs`](../tools/check-links.mjs), and deliberately does
**not** check http(s) links — only that a relative link (`[x](../OTHER.md)`) still
resolves to a real file. That is the mistake worth catching for free on every push (a doc
moved or renamed out from under a link elsewhere); confirming an external URL is still
alive is a noisier, flakier problem this repo doesn't take on in CI.

Several documents draw their diagrams with [mermaid](https://mermaid.js.org/), which
GitHub renders inline from a ` ```mermaid ` code block. A diagram with a syntax error
does not fail anything — it just renders as a red error box on github.com, which nobody
notices until a reader hits it. So CI parses every diagram in every tracked markdown
file, and you can run the same check locally:

```bash
npm run check:mermaid                       # everything git tracks
node tools/check-mermaid.mjs docs/FOO.md    # just one file, while you iterate
```

It reports every bad diagram in one pass, with the line to jump to. It parses rather
than renders, so it needs no browser and takes about a second; see
[`tools/check-mermaid.mjs`](../tools/check-mermaid.mjs) for why, and for how to move the
pinned mermaid version when GitHub upgrades theirs.

Two things worth knowing when you write the markdown itself:

- The check reads the first word of the info string, so ` ```mermaid ` and
  ` ```mermaid title="x" ` are both diagrams.
- To *show* a mermaid block as an example rather than have it rendered and checked,
  wrap it in a longer fence (four or more backticks, or `~~~`). Anything inside that
  outer fence is left alone.

## Editing the code

Every workspace is held to the same TypeScript strictness contract
([`tsconfig.strict.json`](../tsconfig.strict.json)) and linted by one type-aware ESLint
config at the repo root ([`eslint.config.js`](../eslint.config.js)). Both run in CI, and
both run locally:

```bash
npm run typecheck    # every workspace
npm run lint         # every workspace, plus tools/
npm test             # tools/, then every workspace's own suite
```

`npm run lint` is type-aware — the rules worth having here are the `no-unsafe-*` family,
which need real types to say anything — so it costs about as much as a typecheck, not as
much as a formatter. It needs `vendor/pixel-agents` checked out, because `apps/web`
compiles some of the upstream's own sources.

Two conventions the config makes load-bearing rather than decorative:

- A leading underscore (`_request`, `_canvasBox`) means "deliberately unused". Anything
  else unused is an error.
- A module that exports a React component exports *only* components — the provider and
  its hook live in separate files (`AuthProvider.tsx` / `authState.ts`). That is what
  lets Vite hot-replace a component in place instead of reloading the page, which for
  this app also means not having to log in again after every edit.

Where a rule is switched off, or a suppression is narrowed to one line, the reason is
written next to it. If you need a new exception, write the reason too — a bare
`eslint-disable` is not reviewable.

## Commit messages, PR titles, and secrets

`npm install` (or `npm ci`) wires up two git hooks via [husky](https://typicode.github.io/husky/)
(`.husky/`, driven by the root `prepare` script). Both also run again in CI, so a hook
that was skipped or bypassed locally still gets caught before merge.

**Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/)**
(`type(scope): summary`, e.g. `fix(api): reject expired sessions`), checked by the
`commit-msg` hook via [commitlint](https://commitlint.js.org/) against
[`commitlint.config.js`](../commitlint.config.js). The allowed `type`s are the standard set
(`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`) plus `debug`, which this repo already used before anything enforced it.
`scope` is free-form and optional. If a commit is rejected, amend the message
(`git commit --amend`) and try again — the hook only checks the message, not the diff.

**Staged changes are scanned for secrets before every commit** by the `pre-commit` hook,
via [gitleaks](https://github.com/gitleaks/gitleaks). Gitleaks is a standalone Go
binary, not an npm package (the `gitleaks` package on the npm registry is an unrelated
third-party project) — install it yourself once:

```bash
brew install gitleaks                              # macOS
go install github.com/gitleaks/gitleaks/v8@latest  # any platform with Go
# or grab a release binary: https://github.com/gitleaks/gitleaks#installing
```

The hook checks for `gitleaks` on your `PATH` and prints these same instructions if it's
missing, rather than silently skipping the scan. If it flags something that isn't
actually a secret, either rework the line so it doesn't look like one (preferred), or, if
that's not practical, use an [inline `gitleaks:allow`
comment](https://github.com/gitleaks/gitleaks#allowlist) or a `.gitleaks.toml` allowlist
entry — and say why in the same commit.

**PR titles are also checked**, separately from the commit-msg hook, by
[`pr-title.yml`](../.github/workflows/pr-title.yml) using the same Conventional Commits
rule. This is a second check rather than reuse of the hook because the PR title becomes
the squash commit's message on merge, and it can be edited in the GitHub UI without ever
running a local hook.
