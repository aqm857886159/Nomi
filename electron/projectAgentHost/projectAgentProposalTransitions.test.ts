import { describe, expect, it } from "vitest";

import {
  PROPOSAL_LEDGER_ABSENT,
  PROPOSAL_TRANSITION_ACTIONS,
  PROPOSAL_TRANSITION_DOMAINS,
  proposalTransitionStates,
  resolveProposalTransitionAction,
  resolveTransition,
  type ProposalTransitionAction,
  type ProposalTransitionDomain,
  type ProposalTransitionState,
} from "./projectAgentProposalTransitions";

/**
 * The expectation is written out here independently of the module's own tables so
 * the sweep below cannot pass by reading the implementation back to itself.
 */
const ADMITTED_DOMAIN_PAIRS = new Set(
  PROPOSAL_TRANSITION_DOMAINS.map((domain) => `${domain}>${domain}`),
);
const HOST_ANCHORED_PAIRS = new Set(["document>canvas"]);

type Expected =
  | { ok: true; toState: string; admission: readonly string[] }
  | { ok: false; code: string; reason: string };

function expected(
  sourceDomain: ProposalTransitionDomain,
  targetDomain: ProposalTransitionDomain,
  fromState: ProposalTransitionState,
  action: ProposalTransitionAction,
): Expected {
  if (action === "put") {
    if (fromState !== PROPOSAL_LEDGER_ABSENT) {
      return { ok: false, code: "record_exists", reason: "approval_already_recorded" };
    }
    const pair = `${sourceDomain}>${targetDomain}`;
    if (HOST_ANCHORED_PAIRS.has(pair)) {
      return { ok: false, code: "proposal_transition_invalid", reason: "host_anchor_required" };
    }
    if (!ADMITTED_DOMAIN_PAIRS.has(pair)) {
      return { ok: false, code: "proposal_transition_invalid", reason: "cross_domain_admission_absent" };
    }
    return {
      ok: true,
      toState: "pending",
      admission:
        sourceDomain === "canvas"
          ? ["queue-identity", "deferred-canvas-edges"]
          : sourceDomain === "timeline"
            ? ["queue-identity", "deferred-timeline-plan"]
            : ["queue-identity"],
    };
  }
  if (fromState === PROPOSAL_LEDGER_ABSENT) {
    return { ok: false, code: "record_not_found", reason: "approval_not_recorded" };
  }
  if (fromState !== "pending") {
    return { ok: false, code: "proposal_transition_invalid", reason: "lifecycle_action_unavailable" };
  }
  return { ok: true, toState: action === "claim" ? "claimed" : "expired", admission: [] };
}

describe("ProjectAgent proposal transition table", () => {
  it("resolves every (source domain × target domain × state × action) cell", () => {
    let admitted = 0;
    let rejected = 0;
    for (const sourceDomain of PROPOSAL_TRANSITION_DOMAINS) {
      for (const targetDomain of PROPOSAL_TRANSITION_DOMAINS) {
        for (const fromState of proposalTransitionStates()) {
          for (const action of PROPOSAL_TRANSITION_ACTIONS) {
            const coordinate = { sourceDomain, targetDomain, fromState, action } as const;
            const resolution = resolveTransition(coordinate);
            const want = expected(sourceDomain, targetDomain, fromState, action);
            expect({ cell: coordinate, resolution }).toEqual({
              cell: coordinate,
              resolution: want.ok
                ? { ok: true, coordinate, toState: want.toState, admission: want.admission }
                : { ok: false, coordinate, code: want.code, reason: want.reason },
            });
            if (want.ok) admitted += 1;
            else rejected += 1;
          }
        }
      }
    }
    // 8 × 8 × 4 × 3: the sweep really did visit the whole grid.
    expect(admitted + rejected).toBe(768);
    expect(admitted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("names the missing cell coordinate on every rejection", () => {
    const rejection = resolveTransition({
      sourceDomain: "document",
      targetDomain: "canvas",
      fromState: PROPOSAL_LEDGER_ABSENT,
      action: "put",
    });
    expect(rejection).toEqual({
      ok: false,
      coordinate: {
        sourceDomain: "document",
        targetDomain: "canvas",
        fromState: "absent",
        action: "put",
      },
      code: "proposal_transition_invalid",
      reason: "host_anchor_required",
    });
    const foreign = resolveTransition({
      sourceDomain: "timeline",
      targetDomain: "production",
      fromState: PROPOSAL_LEDGER_ABSENT,
      action: "put",
    });
    expect(foreign).toMatchObject({
      ok: false,
      reason: "cross_domain_admission_absent",
      coordinate: { sourceDomain: "timeline", targetDomain: "production" },
    });
  });

  it("maps only settleable lifecycles onto a table action", () => {
    expect(resolveProposalTransitionAction("claimed")).toBe("claim");
    expect(resolveProposalTransitionAction("expired")).toBe("expire");
    for (const unmapped of ["pending", "done", "", undefined, null, 7]) {
      expect(resolveProposalTransitionAction(unmapped)).toBeUndefined();
    }
  });
});
