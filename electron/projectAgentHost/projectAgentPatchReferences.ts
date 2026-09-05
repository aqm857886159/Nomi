/**
 * The entity sets a `ProjectAgentPatch`'s changes are checked against.
 *
 * There are two callers with genuinely different obligations, and collapsing them was a bug:
 *
 *  · **Live delta** (`assertTrustedProjectAgentDelta`) — the patch is validated against the state it
 *    just produced. Every reference must resolve, because the patch and the state are the same fact.
 *  · **History ledger** (`recentAppliedCommands` inside `assertProjectAgentHostState`) — the patch is a
 *    record of something that already happened. A thread the user has since deleted legitimately
 *    leaves patches behind that still name it, its turns and its items.
 *
 * Validating the history against the *present* entity sets held the past to an invariant only the
 * present can satisfy: deleting any thread that had turns made the snapshot unreadable on the next
 * cold start (both snapshot and backup fail `readValidEnvelope`, and the repository then throws
 * `ProjectAgentRepositoryIntegrityError`), and it stayed unreadable until 64 further commands rolled
 * the offending patch out of `PROJECT_AGENT_RECENT_COMMAND_LIMIT`. The in-session path never noticed,
 * because the trusted-append fast path only validates the new delta.
 *
 * `HISTORICAL_PATCH_REFERENCES` keeps every shape, id, enum, timestamp and binding check and drops
 * exactly one thing: cross-entity existence. Nothing else about history validation is relaxed.
 */
export type ProjectAgentPatchReferences = Readonly<{
  threadIds: ReadonlySet<string>;
  turnIds: ReadonlySet<string>;
  turnThreadById: ReadonlyMap<string, string>;
  itemTurnById: ReadonlyMap<string, string>;
  /** False only for the history ledger: shape is still enforced, cross-entity links are not. */
  enforceLinks: boolean;
}>;

/** Answers "yes" to any id. Only ever reachable through `HISTORICAL_PATCH_REFERENCES`. */
class AnyIdSet extends Set<string> {
  override has(): boolean {
    return true;
  }
}

export const HISTORICAL_PATCH_REFERENCES: ProjectAgentPatchReferences = Object.freeze({
  threadIds: new AnyIdSet(),
  turnIds: new AnyIdSet(),
  turnThreadById: new Map<string, string>(),
  itemTurnById: new Map<string, string>(),
  enforceLinks: false,
});

export function liveProjectAgentPatchReferences(input: {
  threadIds: ReadonlySet<string>;
  turnIds: ReadonlySet<string>;
  turnThreadById: ReadonlyMap<string, string>;
  itemTurnById: ReadonlyMap<string, string>;
}): ProjectAgentPatchReferences {
  return Object.freeze({ ...input, enforceLinks: true });
}
