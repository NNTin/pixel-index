# Content policy

This is the content policy for **this index** — the instance run by NNTin at
`pixel-index.nntin.xyz` and its GitHub Pages mirror. It is not a template for
other deployments and makes no claim to be one: anyone self-hosting this
software sets their own policy for their own instance.

## This index is post-moderated

A layout you submit is **public immediately** — there is no approval queue, no review
before it appears. Moderation happens after publication: a moderator or admin acts on a
layout once it is reported or otherwise noticed, not before. This is a deliberate
trade-off (see [ADR 0001](docs/adr/0001-v2-architecture.md), decision 6), not an
oversight, and it means the burden of catching a problem sits with the community and the
moderation team together, not with a gate nothing gets past.

## What may not be submitted

At minimum, a layout (its design, any furniture arrangement that forms an image, or its
title, description or tags) may not depict, contain, or promote:

- Hate symbols or extremist iconography.
- Harassment or targeting of a specific individual.
- Sexual content involving minors.
- Impersonation of another person, project or organization in a way intended to
  deceive.

This list is a floor, not a ceiling. A moderator can act on content that is clearly in
bad faith even if it does not fit neatly into one of the categories above — the test is
whether a reasonable person would find it a deliberate attempt to cause harm, not
whether it matches a bullet point exactly.

## How to report a layout

Reporting tooling does not exist yet in this index's software (see the note below). For
now, contact a moderator or admin directly — see the account list in
[MODERATORS.md](MODERATORS.md) — with the layout's link and what's wrong with it. You
can expect an initial response within a few days; a small volunteer team, not a
staffed trust-and-safety desk, is doing this.

## Enforcement

Three actions, applied to the layout or the account, in increasing severity:

| Action | Reversible? | What it means |
|---|---|---|
| **Hide** | Yes | The layout disappears from every public read path. Used for a first offense, or when the report needs a closer look before a final call. |
| **Remove** | No | The layout disappears from every public read path, permanently — a moderator-removed layout's content cannot be laundered back in by resubmitting the same bytes under a new title. Used once a violation is confirmed. |
| **Block the author** | The block itself is reversible; layouts hidden by it are not automatically restored | Every one of the account's currently-public layouts is hidden in the same action, the account can no longer submit or edit anything, and its active sessions are revoked. Used for repeat violations or a single severe one. |

A moderator can hide or remove any single layout and record why. Blocking an account —
and blocking or unblocking a **moderator or admin** account specifically — requires an
admin. Every one of these actions is recorded with who did it, when, and why, in an
append-only log that is never edited or deleted after the fact.

## Appeals

Contact a moderator or admin — the same ones you'd report a layout to. If they agree a
hide or a block was wrong, they reverse it. There is no second layer beyond that today:
this is a small volunteer project, not an organization with a formal appeals board.
Disagreements are worked out by talking to the people who made the call.

## A note on what exists today

This policy describes the model the index is built around, not only what the current
software can already do end-to-end. Moderators can hide, remove and block through the
API right now (see `services/api/README.md`). A dedicated in-app report button and a
moderation console are planned (tracked as later work on the same project) but do not
exist yet — reporting today is the manual, contact-a-person path above.
