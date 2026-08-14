# Moderator handbook

For moderators and admins of **this index**. Read [CONTENT_POLICY.md](CONTENT_POLICY.md)
first — this document is about how to apply it, not what it says.

## Who can moderate

Pixel Index derives capabilities directly from the configured Discord guild. A Discord
moderator role grants the Moderator capability. Configured admin user IDs grant Admin,
which inherits every Moderator capability. Pixel Index has no role editor and no local
account block: change the Discord role, or remove/ban the Discord member.

Capability changes are observed within the configured membership cache TTL (one minute
by default). The Discord bot Pico is not involved and may be offline.

## The tools you have

The dashboard has a moderation page. The corresponding API actions are:

- `PATCH /api/v1/layouts/:slug` with `{ "visibility": "hidden" | "removed" | "public", "reason": "…" }`
  — hide, remove, or restore a layout. A reason is required.
- `PATCH /api/v1/layouts/:slug` with metadata and a `reason` — correct another user's
  title, description, or tags without hiding an otherwise acceptable layout.
- `PATCH /api/v1/layouts/:slug` with `{ "slug": "new-vanity-name", "reason": "…" }` —
  grant a vanity URL. Every submission starts with a random slug by design, to prevent
  first-come-first-served name-squatting; a moderator is the only one who can hand out a
  memorable one afterwards, for anyone. A slug already in use by a **public or hidden**
  layout is rejected outright (never silently modified into something like
  `-2`). A slug that only a **removed or deleted** layout still holds is not blocking: it
  is handed to the layout you're patching, and the old holder is automatically given a
  fresh random slug in the same action, so nothing is left broken. There is no redirect
  from wherever a slug used to point to wherever it ends up next.
- Admins additionally get a **read-only** directory of accounts that have interacted
  with Pixel Index, their last verified Basic/Moderator/Admin capability, and their
  total submitted layouts. It does not enumerate the Discord guild.

Leaving or being banned from Discord prevents new submissions, edits, replacements and
privileged actions after revalidation. It deliberately does **not** unpublish existing
layouts. Layout visibility remains a separate moderation decision; the former member can
still view and delete their own layouts.

## Judging borderline cases

- Start from [CONTENT_POLICY.md](CONTENT_POLICY.md)'s list, but use judgment for clearly
  bad-faith behavior that does not fit a bullet point.
- Prefer **hide** when uncertain. It is reversible and buys time for a second opinion.
- Prefer editing metadata when only the title, description, or tags are objectionable.
- Ask another moderator before acting when unsure.

## Always record a reason

Every visibility change *you* make, and every edit to another user's metadata, requires
a reason. Write it for the next person reading the append-only `moderation_actions` log,
not only for yourself now. (An owner toggling their own layout between public and hidden
is not a moderation action and needs none — see CONTENT_POLICY.md.)

## Recuse yourself from your own layouts

Never moderate your own layout or decide a report against your own content. Ask another
moderator to review it so the community and audit log can verify an independent decision.
