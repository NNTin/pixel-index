# Content policy

This is the content policy for **this index** — the instance run by NNTin at
`pixel-index.nntin.xyz` and its GitHub Pages mirror. It is not a template for
other deployments and makes no claim to be one: anyone self-hosting this
software sets their own policy for their own instance.

## This index is post-moderated

A layout you submit is **public immediately** — there is no approval queue, no review
before it appears. Moderation happens after publication: a moderator or admin acts on a
layout once it is reported or otherwise noticed, not before. A tile grid can depict
something like a hate symbol and will be public until someone acts on it, which is
exactly why "hidden" has to mean hidden from every public read path (list, detail,
download, preview alike) the moment a moderator acts, not just the gallery view.

## Owners control their own drafts

An owner can toggle their own layout between public and hidden at any time, no reason
needed — hiding your own work-in-progress is not a moderation action. This works even on
a layout a moderator hid: an owner can put it back to public, the same as hiding it
themselves. An owner can also delete their own layout outright, permanently — see
Enforcement below for what that means and who else can do it.

Hidden is not private. A backup of every layout, hidden ones included, still exists —
see [issue #63](https://github.com/pixel-agents-hq/index/issues/63). Repeatedly
un-hiding content a moderator hid for cause, or resubmitting content a moderator
deleted, is treated as bad faith and can lead to a block under Enforcement below, same
as any other repeat violation.

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

There is no in-app report button — this index has no report-intake queue. Contact a
moderator or admin directly — see the account list in
[MODERATORS.md](MODERATORS.md) — with the layout's link and what's wrong with it. Expect
an initial response within a few days; a small volunteer team, not a staffed
trust-and-safety desk, handles this.

## Enforcement

Moderators hide, delete and block through the app's Moderation and Admin pages (see
`services/api/README.md` for the endpoints behind them). Three actions, applied to the
layout or the account, in increasing severity:

| Action | Reversible? | What it means |
|---|---|---|
| **Hide** | Yes | The layout disappears from every public read path. Used for a first offense, or when the report needs a closer look before a final call. |
| **Delete** | No | The layout disappears from every public read path, permanently — the same irreversible action an owner has always had for their own layout, now also available to a moderator on anyone's. Used once a violation is confirmed. Note: unlike a moderator's *hide*, a moderator's *delete* does not stop the same OWNER from later resubmitting the identical bytes — see `services/api/README.md`'s dedupe notes. Someone doing that repeatedly is a bad-faith pattern, handled the same as any repeat violation: a block, below. |
| **Block the author** | The block itself is reversible; layouts hidden by it are not automatically restored | Every one of the account's currently-public layouts is hidden in the same action, the account can no longer submit or edit anything, and its active sessions are revoked. Used for repeat violations or a single severe one. |

A moderator can hide or delete any single layout and record why. Blocking an account —
and blocking or unblocking a **moderator or admin** account specifically — requires an
admin. Every one of these actions is recorded with who did it, when, and why, in an
append-only log that is never edited or deleted after the fact.

## Appeals

Contact a moderator or admin — the same ones you'd report a layout to. If they agree a
hide or a block was wrong, they reverse it. There is no second layer beyond that today:
this is a small volunteer project, not an organization with a formal appeals board.
Disagreements are worked out by talking to the people who made the call.
