import type { ReactNode } from 'react';

import { getMeta } from '../api/client';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/authState';

/**
 * "Only authenticated Discord users" — the client half of it.
 *
 * The capability itself is #21's: `user.submission.allowed`, revalidated
 * against Discord by the API on every write. This renders the three ways a
 * visitor can fail it — logged out, logged in but not a member, member whose
 * Discord grant needs reconnecting — and, either way, the invite. Hiding a
 * button is not authorization (#15): a visitor who navigates past this still
 * meets the same 403 the API gives everyone else.
 *
 * Shared by `/submit` and the layout editor (#65), which gate on exactly the
 * same capability and differ only in what they call the thing being gated.
 */
export function SubmissionGate({ what, children }: { what: string; children: ReactNode }) {
  const { status, user, login } = useAuth();
  // Public, not gated behind login — someone deciding whether to join the
  // community must not need to sign in first just to see the invite.
  const metaState = useApi((signal) => getMeta(signal), []);
  const inviteUrl = metaState.status === 'ready' ? metaState.data.discordInviteUrl : null;

  if (status === 'loading') {
    return <p className="text-muted">Loading…</p>;
  }

  if (user?.submission.allowed) {
    return <>{children}</>;
  }

  const loggedOut = !user;
  const reconnect = !loggedOut && user.submission.reason === 'discord_reauthorization_required';

  return (
    <>
      <p className="mt-3 text-muted">
        {reconnect
          ? 'Reconnect Discord so Pixel Index can verify your community membership.'
          : loggedOut
            ? `${what} is available to members of the official Discord community. Log in with Discord to check your membership.`
            : `${what} is available to members of the official Discord community.`}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {reconnect ? (
          <button type="button" onClick={login} className="border-2 border-accent px-4 py-2 text-accent">
            Reconnect Discord
          </button>
        ) : loggedOut ? (
          <button type="button" onClick={login} className="border-2 border-accent px-4 py-2 text-accent">
            Log in with Discord
          </button>
        ) : null}
        {inviteUrl && (
          <a
            href={inviteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block border-2 border-accent px-4 py-2 text-accent"
          >
            Join the Discord server
          </a>
        )}
      </div>
    </>
  );
}
