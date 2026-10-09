import { startSpan } from '../observability/tracer'
import { isProvenExitedPtyAttachRefusal } from '../../shared/pty-attach-absence-evidence'
import { previousRelayMayHoldTerminals } from '../ssh/ssh-previous-relay-terminals'
import {
  SSH_PTY_IDENTITY_MISMATCH_ERROR,
  SSH_SESSION_EXPIRED_ERROR,
  SshPtyAbsentFromRelayError,
  SshPtyHeldByPreviousRelayError,
  SshPtyProvenExitedOnRelayError,
  isSshPtyIdentityMismatchError
} from './ssh-pty-errors'

/**
 * Which refusal the relay's "not found" was classified into.
 *
 * `proven_exited` and `absent` are minted with the same `SSH_SESSION_EXPIRED` text and are
 * indistinguishable downstream (`spawn-execute.ts` says so outright: "the message alone cannot
 * carry this decision"). Only one of them observed the process, so recording the classification
 * here is the only place the distinction can still be captured.
 */
export type SshPtyAttachRefusal =
  | 'identity_mismatch'
  | 'proven_exited'
  | 'held_by_previous_relay'
  | 'absent'

/** One `ssh.pty-attach-refusal` span per classified refusal. No ptyId, session id or target id. */
function recordSshPtyAttachRefusal(refusal: SshPtyAttachRefusal): void {
  startSpan('ssh.pty-attach-refusal', {
    attributes: { kind: 'ssh', 'attach.refusal': refusal }
  }).end()
}

/**
 * Classify a host "not found" and throw the matching error, recording which branch was taken.
 *
 * Why the class: the relay answered for this exact id, so callers holding a pane binding may retire
 * it and spawn fresh. Plain `SSH_SESSION_EXPIRED` cannot say that — a restarted relay renumbers
 * from pty-1, so the message alone is indistinguishable from a lost link.
 *
 * Why the subclass: the relay marks the one refusal it backed with a pid probe. Without the marker
 * the answer is the "no such id" union, which is not evidence the shell ended, so the narrow class
 * is minted only when the relay said so (docs/reference/ssh-execution-boundary.md).
 */
export async function throwClassifiedSshPtyAttachRefusal(args: {
  error: unknown
  relaySessionId: string
  connectionId: string
}): Promise<never> {
  if (isSshPtyIdentityMismatchError(args.error)) {
    // The id names a LIVE PTY owned by another pane, so this is not evidence of absence.
    recordSshPtyAttachRefusal('identity_mismatch')
    throw new Error(
      `${SSH_SESSION_EXPIRED_ERROR}: ${args.relaySessionId} ${SSH_PTY_IDENTITY_MISMATCH_ERROR}`
    )
  }
  if (isProvenExitedPtyAttachRefusal(args.error)) {
    recordSshPtyAttachRefusal('proven_exited')
    throw new SshPtyProvenExitedOnRelayError(`${SSH_SESSION_EXPIRED_ERROR}: ${args.relaySessionId}`)
  }
  if (await previousRelayMayHoldTerminals(args.connectionId)) {
    recordSshPtyAttachRefusal('held_by_previous_relay')
    throw new SshPtyHeldByPreviousRelayError(args.relaySessionId)
  }
  recordSshPtyAttachRefusal('absent')
  throw new SshPtyAbsentFromRelayError(`${SSH_SESSION_EXPIRED_ERROR}: ${args.relaySessionId}`)
}
