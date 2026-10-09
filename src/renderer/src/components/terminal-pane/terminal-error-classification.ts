// Why the sources live here rather than in TerminalErrorToast: the toast builds separate `test` and
// `replace` RegExp instances from each (a lone /g regex carries lastIndex across .test() calls), and
// a classifier needs the same tokens. One source, two consumers, no drift.

// A reattach the host answered "no such session" for: the SSH provider's expiry token, the relay's
// raw not-found string when nothing mapped it, or a daemon generation old enough to still refuse a
// pane respawning onto an id it is tearing down (#18046). None proves the shell died.
export const UNREATTACHABLE_SESSION_SOURCES = [
  'SSH_SESSION_EXPIRED:[ \\t]*\\S*(?:[ \\t]+SSH_PTY_IDENTITY_MISMATCH)?',
  'PTY "[^"\\r\\n]*" not found(?: \\(identity mismatch\\))?',
  '(?:SessionNotFoundError: )?Session not found: \\S+'
]
export const SOURCE_RESTORE_REQUIRED_SOURCE =
  'SSH_PTY_SOURCE_RESTORE_REQUIRED(?::[ \\t]*\\S*(?:[ \\t]+\\S+)?)?'
export const HELD_BY_PREVIOUS_RELAY_SOURCE = 'SSH_PTY_HELD_BY_PREVIOUS_RELAY(?::[ \\t]*\\S*)?'
export const OWNER_HOST_MISMATCH_SOURCE = 'terminal_pane_owner_host_mismatch'
export const TERMINAL_HOST_GONE_SOURCE = '(^|[^a-z0-9_])terminal_host_gone(?=$|[^a-z0-9_])'

const OWNER_UNVERIFIED_MARKER = 'terminal_pane_owner_unverified'
const OWNER_CHANGED_MARKER = 'terminal_pane_owner_changed'
const IDENTITY_MISMATCH_MARKERS = ['SSH_PTY_IDENTITY_MISMATCH', '(identity mismatch)']

/**
 * What the pane was told, as a low-cardinality token.
 *
 * `unreattachable_session` deliberately cannot separate a proven-exited shell from one the host
 * merely has no record of: both are minted with the same `SSH_SESSION_EXPIRED` text, and the
 * distinction is only observable in main (`ssh.pty-attach-refusal`). Correlate the two spans.
 */
export type TerminalErrorCode =
  | 'unreattachable_session'
  | 'source_restore_required'
  | 'held_by_previous_relay'
  | 'owner_host_mismatch'
  | 'owner_unverified'
  | 'owner_changed'
  | 'terminal_host_gone'
  | 'other'

const CLASSIFIERS: readonly { code: TerminalErrorCode; pattern: RegExp }[] = [
  { code: 'source_restore_required', pattern: new RegExp(SOURCE_RESTORE_REQUIRED_SOURCE) },
  { code: 'held_by_previous_relay', pattern: new RegExp(HELD_BY_PREVIOUS_RELAY_SOURCE) },
  { code: 'owner_host_mismatch', pattern: new RegExp(OWNER_HOST_MISMATCH_SOURCE) },
  { code: 'owner_unverified', pattern: new RegExp(OWNER_UNVERIFIED_MARKER) },
  { code: 'owner_changed', pattern: new RegExp(OWNER_CHANGED_MARKER) },
  { code: 'terminal_host_gone', pattern: new RegExp(TERMINAL_HOST_GONE_SOURCE) },
  ...UNREATTACHABLE_SESSION_SOURCES.map((source) => ({
    code: 'unreattachable_session' as const,
    pattern: new RegExp(source)
  }))
]

export type TerminalErrorClassification = {
  code: TerminalErrorCode
  /** The id names a LIVE PTY owned by another pane, which is not evidence of absence. */
  identityMismatch: boolean
}

export function classifyTerminalError(message: string): TerminalErrorClassification {
  const match = CLASSIFIERS.find((classifier) => classifier.pattern.test(message))
  return {
    code: match?.code ?? 'other',
    identityMismatch: IDENTITY_MISMATCH_MARKERS.some((marker) => message.includes(marker))
  }
}
