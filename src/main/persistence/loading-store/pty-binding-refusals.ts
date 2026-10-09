import { hasClosedTerminalTabRecord } from '../../../shared/closed-terminal-tab-tombstones'
import { isTerminalLeafId } from '../../../shared/stable-pane-id'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { TerminalSessionPartition } from '../terminal-topology/terminal-owner-invariants'
import { layoutContainsLeafId } from '../restoring-sessions/terminal-layout-normalization'
import type { PtyBindingSourceExpectation } from './store'

export type PtyBindingRefusalRequest = {
  tabId: string
  leafId: string
  expectedBinding?: { ptyId: string; incarnationId?: string }
  expectedSourceBinding?: PtyBindingSourceExpectation
  mayCreate?: boolean
  mayReviveRetiredSurface?: boolean
}

/** Which fence stopped the write. Low-cardinality: it lands on the `persistence.pty-binding` span,
 *  and a refusal with no stated fence is exactly the blind spot this names. */
export type PtyBindingRefusalReason =
  | 'source_binding_mismatch'
  | 'expected_binding_mismatch'
  | 'closed_tab_tombstone'
  | 'retired_surface_tombstone'
  | 'would_create_topology'

/**
 * The five fences a binding must clear before anything is mutated, so a refusal leaves nothing
 * half-written. Order matters: every reason here is returned before the write path or the
 * fast lane can run, which is what the relay's lease expiry and the stable-owner throw rely on.
 *
 * Returns the fence that stopped it, or `null` to proceed.
 */
export function ptyBindingRefusalReason(
  args: PtyBindingRefusalRequest,
  session: WorkspaceSessionState,
  bindingWorktreeId: string,
  paneKey: string,
  /** Every host partition: a close is recorded where the tab lived, which need not be where this
   *  binding lands (older relay reattaches left SSH panes in `local`). */
  partitions: readonly TerminalSessionPartition[]
): PtyBindingRefusalReason | null {
  if (args.expectedSourceBinding) {
    const expected = args.expectedSourceBinding
    if (expected.tabId !== args.tabId) {
      return 'source_binding_mismatch'
    }
    const sourceTab = session.tabsByWorktree?.[bindingWorktreeId]?.find(
      (candidate) => candidate.id === expected.tabId && candidate.worktreeId === bindingWorktreeId
    )
    const sourceLayout = session.terminalLayoutsByTabId?.[expected.tabId]
    const sourcePaneKey = `${expected.tabId}:${expected.leafId}`
    if (
      !sourceTab ||
      sourceLayout?.ptyIdsByLeafId?.[expected.leafId] !== expected.ptyId ||
      !layoutContainsLeafId(sourceLayout.root, expected.leafId) ||
      (expected.incarnationId !== undefined &&
        session.terminalPtyIncarnationsByPaneKey?.[sourcePaneKey] !== expected.incarnationId)
    ) {
      return 'source_binding_mismatch'
    }
  }
  if (args.expectedBinding) {
    const tab = session.tabsByWorktree?.[bindingWorktreeId]?.find(
      (candidate) => candidate.id === args.tabId && candidate.worktreeId === bindingWorktreeId
    )
    const boundPtyId = session.terminalLayoutsByTabId?.[args.tabId]?.ptyIdsByLeafId?.[args.leafId]
    if (
      !tab ||
      boundPtyId !== args.expectedBinding.ptyId ||
      session.terminalPtyIncarnationsByPaneKey?.[paneKey] !== args.expectedBinding.incarnationId
    ) {
      return 'expected_binding_mismatch'
    }
  }
  const existingTab = session.tabsByWorktree?.[bindingWorktreeId]?.find(
    (candidate) => candidate.id === args.tabId
  )
  // Why: a closed tab's spawn can commit after the close, even after a crash and relaunch; tab
  // ids are uuids, so a recorded id is never a new tab.
  if (
    !existingTab &&
    partitions.some((partition) =>
      hasClosedTerminalTabRecord(partition.session.closedTerminalTabTombstonesByTabId, args.tabId)
    )
  ) {
    return 'closed_tab_tombstone'
  }
  // Mirrors the four creating branches of the write path — mint a tab, mint a root leaf, split
  // the root and graft a leaf, mint a layout — each of which sets `terminalMembershipChanged`.
  if (
    args.mayReviveRetiredSurface === false &&
    session.terminalSurfaceTombstonesByPaneKey?.[paneKey]
  ) {
    return 'retired_surface_tombstone'
  }
  if (args.mayCreate === false) {
    const existingLayout = session.terminalLayoutsByTabId?.[args.tabId]
    const wouldCreateTopology =
      !existingTab ||
      (isTerminalLeafId(args.leafId) &&
        (!existingLayout ||
          !existingLayout.root ||
          !layoutContainsLeafId(existingLayout.root, args.leafId)))
    if (wouldCreateTopology) {
      return 'would_create_topology'
    }
  }
  return null
}
