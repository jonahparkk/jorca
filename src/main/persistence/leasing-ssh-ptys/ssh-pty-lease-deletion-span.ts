import { startSpan } from '../../observability/tracer'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'

/** Named for the delete path itself, never its caller, so a new caller cannot silently mislabel. */
export type SshPtyLeaseDeleteReason = 'explicit_single' | 'target_teardown' | 'retired_tombstone'

/**
 * Marks name their winner by ptyId, and nothing clears a mark when that winner is deleted
 * (`upsertSshRemotePtyLease` only clears on the marked lease's OWN id going live again). A delete
 * that strands one leaves its pane refusing the predecessor and unable to reach the successor, so
 * this count is the whole point of the span: it is the moment the damage is done, and today it is
 * the one lease mutation that leaves no trace at all.
 */
export function countMarksNamingDeletedLeases(
  retained: readonly SshRemotePtyLease[],
  deleted: readonly SshRemotePtyLease[]
): number {
  if (deleted.length === 0) {
    return 0
  }
  const deletedPtyIds = new Set(deleted.map((lease) => lease.ptyId))
  return retained.filter(
    (lease) => lease.supersededBy !== undefined && deletedPtyIds.has(lease.supersededBy)
  ).length
}

/**
 * One `persistence.ssh-pty-lease-delete` span per delete that removed something.
 *
 * Attributes are low-cardinality on purpose, matching `persistence.pty-binding`: no ptyId, pane key,
 * worktree id or SSH target id ever lands in the trace file.
 */
export function recordSshPtyLeaseDeletion(entry: {
  reason: SshPtyLeaseDeleteReason
  deleted: readonly SshRemotePtyLease[]
  retained: readonly SshRemotePtyLease[]
}): void {
  if (entry.deleted.length === 0) {
    return
  }
  const orphanedMarks = countMarksNamingDeletedLeases(entry.retained, entry.deleted)
  startSpan('persistence.ssh-pty-lease-delete', {
    attributes: {
      kind: 'persistence',
      'lease.delete_reason': entry.reason,
      'lease.deleted': entry.deleted.length,
      // Sorted and joined so the set reads as one low-cardinality token rather than N attributes.
      'lease.deleted_states': [...new Set(entry.deleted.map((lease) => lease.state))]
        .sort()
        .join(','),
      'lease.orphaned_marks': orphanedMarks
    }
  }).end()
}
