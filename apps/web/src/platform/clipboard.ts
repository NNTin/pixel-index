/**
 * Copying to the clipboard, typed the way browsers actually behave.
 *
 * `lib.dom` is optimistic about this corner of the platform: it declares
 * `Navigator.clipboard` as a non-optional `Clipboard`, and `document.execCommand`
 * as a method that is simply there. Neither holds everywhere this app runs —
 * the async Clipboard API is gated on a secure context, so a plain-HTTP dev
 * server or self-hosted deploy has no `clipboard` at all, older Safari shipped
 * the object without `writeText`, and jsdom implements neither API.
 *
 * Because the declarations are wrong rather than merely incomplete, the guards
 * that make copying work read to TypeScript as dead code — which is what had
 * `@typescript-eslint/no-unnecessary-condition` switched off for this whole
 * workspace (#44). Correcting the types is the fix; a declaration merge cannot
 * do it (`interface Navigator { clipboard?: … }` conflicts with lib.dom's
 * non-optional member), so this module owns the two casts that widen them back
 * to reality, and nothing else in the app needs to know.
 */

/**
 * `navigator` and `document` as this app is willing to assume they are.
 *
 * Cast through `unknown` and *replacing* the lib.dom type rather than
 * intersecting with it: an intersection keeps the non-optional member, so
 * `Navigator & { clipboard?: … }` still says `clipboard` is always there and
 * changes nothing. Only these two members are named, because only these two
 * are read here.
 */
interface MaybeClipboardNavigator {
  clipboard?: { writeText?: (text: string) => Promise<void> } | undefined;
}

interface MaybeExecCommandDocument {
  execCommand?: ((commandId: string) => boolean) | undefined;
}

/**
 * The async clipboard writer, or `undefined` where the platform has no such
 * thing. Callers are expected to fall back to {@link copyViaSelection}.
 */
export function clipboardWriteText(): ((text: string) => Promise<void>) | undefined {
  const { clipboard } = navigator as unknown as MaybeClipboardNavigator;
  return clipboard?.writeText?.bind(clipboard);
}

/**
 * The pre-Clipboard-API way to copy: put the text in an offscreen textarea,
 * select it, and ask the document to copy the selection.
 *
 * Reached only by the browsers that have no async clipboard, which is why the
 * deprecation is tolerated here and nowhere else — removing it would leave
 * those visitors with a Copy button that silently does nothing.
 *
 * Throws when the copy is refused, so the caller can show its "select the JSON
 * below instead" message.
 */
export function copyViaSelection(text: string): void {
  // Bound at the point of access, so it is a callable rather than a loose
  // method reference (@typescript-eslint/unbound-method).
  const doc = document as unknown as MaybeExecCommandDocument;
  const execCommand = doc.execCommand?.bind(document);
  if (!execCommand) throw new Error('Copying is not supported in this browser.');

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  try {
    if (!execCommand('copy')) throw new Error('Copy command was rejected.');
  } finally {
    textarea.remove();
  }
}
