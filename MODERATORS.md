# Moderator handbook

For moderators and admins of **this index**. Read [CONTENT_POLICY.md](CONTENT_POLICY.md)
first — this document is about how to apply it, not what it says.

## Who moderates this index

_(To be filled in once the first moderators are appointed. List Discord/GitHub handles
and role — moderator or admin — here.)_

## The tools you have

There is no moderation console yet — every action here is a direct API call. See
`services/api/README.md` for the full request/response shapes.

- `PATCH /api/v1/layouts/:slug` with `{ "visibility": "hidden" | "removed" | "public", "reason": "…" }`
  — hide, remove, or restore a layout. `reason` is required for every one of these; it is
  not optional and not a formality, see "always record a reason" below.
- `PATCH /api/v1/layouts/:slug` with `{ "title": … }` (no `visibility`) — edit another
  user's layout metadata directly, for something like a slur in a title that does not
  rise to hiding the whole layout. Also requires a `reason`.
- `PATCH /api/v1/users/:id/block` with `{ "blocked": true, "reason": "…" }` — block an
  account. Hides every layout it currently has public, in the same action, and revokes
  its sessions. `reason` is required to block (not to unblock).
- `PATCH /api/v1/users/:id/role` — **admin only.** Promote or demote a moderator.

## Judging borderline cases

- Start from [CONTENT_POLICY.md](CONTENT_POLICY.md)'s list, but the list is a floor, not
  an exhaustive rulebook — use judgment for anything that is clearly bad-faith even if it
  doesn't fit a bullet point.
- Prefer **hide** over **remove** when you are not certain yet. Hiding is reversible and
  buys time to ask a second moderator or the reporter for more context; removing is not,
  and a moderator-removed layout's content also can't be laundered back in by
  resubmitting the same bytes — treat it as the "we are sure" action, not the default
  first move.
- Prefer editing metadata over hiding the whole layout when only the metadata (a title,
  a description, a tag) is the problem — the layout design itself may be fine.
- When you are not sure, ask another moderator before acting rather than after. There is
  no harm in a second opinion; there is real harm in a wrong removal that cannot be
  undone.

## When to escalate to an admin

- Blocking an account that is itself a moderator or admin — the API enforces this, an
  admin has to do it, not just review it.
- Any case where the right call is genuinely unclear even after asking another
  moderator.
- Anything that looks like it could need action outside this index entirely (a genuine
  safety concern, not just a bad layout).

## Always record a reason

Every action above that changes a layout's visibility, edits someone else's metadata, or
blocks an account requires a `reason`, and the API enforces this — it is not something
you can skip by leaving it blank. Write the reason for the *next person who reads the
log*, not just for yourself right now: "spam" is less useful six months from now than
"reposted the same layout under 4 different titles after being asked to stop." The
append-only audit log (`moderation_actions` — see `services/api/README.md`, "the audit
log is append-only") is the only record of why a call was made; write it like it's the
only one anyone will ever get.

## Recuse yourself from your own layouts

Never hide, remove, edit, or otherwise moderate your own layout, or make the call on a
report against your own account. Ask another moderator to review it instead. This isn't
about whether you'd be fair — it's that a moderator acting on their own content is not
something the community can verify was fair, and the audit log recording "moderator X
hid moderator X's own layout" is not a log that builds trust.

## Unblocking does not restore

If you unblock an account, its previously-public layouts stay hidden — unblocking
reverses the account restriction, not the individual moderation decisions. An account
back in good standing does not retroactively re-validate everything it published while
blocked. If a layout should come back, restore it with its own `PATCH … visibility:
public` call, with its own reason.
