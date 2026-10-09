import { startSpan } from '../../observability/tracer'
import { sshRemotePtyLeaseAllowsReattach, type SshRemotePtyLease } from '../../../shared/ssh-types'

export type SshPtyLeaseLedgerSurvey = {
  leases: number
  marked: number
  /** Marks naming a ptyId no lease record holds. Such a pane refuses its predecessor and cannot
   *  reach its successor, so it can never route again — the count that matters. */
  danglingMarks: number
  /** Expired, unmarked: still askable, which is the deliberate direction for a genuine orphan. */
  orphans: number
  reattachable: number
}

export function surveySshPtyLeaseLedger(
  leases: readonly SshRemotePtyLease[]
): SshPtyLeaseLedgerSurvey {
  const knownPtyIds = new Set(leases.map((lease) => lease.ptyId))
  let marked = 0
  let danglingMarks = 0
  let orphans = 0
  let reattachable = 0
  for (const lease of leases) {
    if (lease.supersededBy !== undefined) {
      marked += 1
      if (!knownPtyIds.has(lease.supersededBy)) {
        danglingMarks += 1
      }
    } else if (lease.state === 'expired' && lease.relayIdRecycled !== true) {
      orphans += 1
    }
    if (sshRemotePtyLeaseAllowsReattach(lease)) {
      reattachable += 1
    }
  }
  return { leases: leases.length, marked, danglingMarks, orphans, reattachable }
}

/**
 * Report-only: counts the ledger's shape, repairs nothing.
 *
 * Emitted once per connect, right after supersession reconciles and immediately before the reattach
 * set is read — so the numbers describe exactly the ledger that connect is about to route on.
 */
export function recordSshPtyLeaseLedgerSurvey(leases: readonly SshRemotePtyLease[]): void {
  const survey = surveySshPtyLeaseLedger(leases)
  startSpan('persistence.ssh-pty-lease-ledger', {
    attributes: {
      kind: 'persistence',
      'ledger.leases': survey.leases,
      'ledger.marked': survey.marked,
      'ledger.dangling_marks': survey.danglingMarks,
      'ledger.orphans': survey.orphans,
      'ledger.reattachable': survey.reattachable
    }
  }).end()
}
