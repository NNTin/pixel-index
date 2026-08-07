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
empty page — are git-versioned in this repository (currently `layouts/`, moving to
`seed/` per [#18](https://github.com/NNTin/pixel-index/issues/18)) rather than living
only in the database. Proposing a *new* seed layout, or a fix to an existing one, is
still a pull request:

```bash
git submodule update --init --recursive
npm ci
npm run validate
```

CI runs the same validation the live submit flow does, so a seed layout can never be one
the site would itself reject. This path is specifically for the curated starter set —
publishing your own layout for the community index is the web flow above.
