import { describe, expect, it } from "vitest";
import { buildExperienceCandidate, expireExperience, recordExperienceReuse } from "./experiencePolicy";

const evidence = {
  problem: "模型列表为空",
  action: "补齐认证字段",
  outcome: "列表恢复",
  verification: "契约和 loopback 通过",
  eventSeqs: [1, 2, 3],
};

function draft(kind: "fact" | "procedure" | "troubleshooting" | "invariant" | "decision" | "training-example") {
  return { kind, title: "可复用经验", content: "先验证再沉淀", evidence, confidence: 0.9 } as const;
}

describe("experience policy", () => {
  it("routes green facts directly to project memory", () => {
    const candidate = buildExperienceCandidate(draft("fact"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    expect(candidate).toMatchObject({ destination: "memory", risk: "green", status: "active", scope: "project" });
  });

  it("keeps procedures in shadow until two independent successful reuses", () => {
    const first = buildExperienceCandidate(draft("procedure"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    expect(first).toMatchObject({ destination: "skill", risk: "yellow", status: "shadow" });
    const second = recordExperienceReuse(first, { trajectoryId: "t2", verified: true, now: "2026-09-03T00:00:00.000Z" });
    expect(second.status).toBe("shadow");
    const promoted = recordExperienceReuse(second, { trajectoryId: "t3", verified: true, now: "2026-09-04T00:00:00.000Z" });
    expect(promoted.status).toBe("active");
  });

  it("keeps red engineering knowledge quarantined", () => {
    expect(buildExperienceCandidate(draft("invariant"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" })).toMatchObject({ destination: "gate", risk: "red", status: "quarantined" });
    expect(buildExperienceCandidate(draft("decision"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" })).toMatchObject({ destination: "adr", risk: "red", status: "quarantined" });
  });

  it("demotes after three failures, contradiction, or expiry", () => {
    const first = buildExperienceCandidate(draft("procedure"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    const failed1 = recordExperienceReuse(first, { trajectoryId: "t2", verified: false, now: "2026-09-03T00:00:00.000Z" });
    const failed2 = recordExperienceReuse(failed1, { trajectoryId: "t3", verified: false, now: "2026-09-04T00:00:00.000Z" });
    const failed3 = recordExperienceReuse(failed2, { trajectoryId: "t4", verified: false, now: "2026-09-05T00:00:00.000Z" });
    expect(failed3.status).toBe("demoted");
    const contradicted = recordExperienceReuse(first, { trajectoryId: "t5", verified: false, contradicted: true, now: "2026-09-03T00:00:00.000Z" });
    expect(contradicted.status).toBe("demoted");
  });

  it("deduplicates failed reuses as well as successful reuses", () => {
    const candidate = buildExperienceCandidate(draft("procedure"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    const failed = recordExperienceReuse(candidate, { trajectoryId: "t2", verified: false });
    const retried = recordExperienceReuse(failed, { trajectoryId: "t2", verified: false });
    expect(retried).toEqual(failed);
    expect(retried.failureCount).toBe(1);
  });

  it("does not activate incomplete evidence", () => {
    const candidate = buildExperienceCandidate({ ...draft("fact"), evidence: { problem: "只有问题" } }, { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    expect(candidate.destination).toBe("incident");
    expect(candidate.status).toBe("active");
    expect(candidate.eligibleForPrompt).toBe(false);
  });

  it("never auto-activates a global candidate and expires stale yellow knowledge", () => {
    const global = buildExperienceCandidate({ ...draft("fact"), scope: "global" }, { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    expect(global.status).toBe("quarantined");
    expect(global.eligibleForPrompt).toBe(false);
    const shadow = buildExperienceCandidate(draft("procedure"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    expect(expireExperience(shadow, "2026-12-03T00:00:00.000Z").status).toBe("expired");
  });

  it("uses content identity rather than event sequence numbers for deduplication", () => {
    const first = buildExperienceCandidate(draft("procedure"), { projectId: "p1", trajectoryId: "t1", now: "2026-09-02T00:00:00.000Z" });
    const second = buildExperienceCandidate({ ...draft("procedure"), evidence: { ...evidence, eventSeqs: [90, 91] } }, { projectId: "p1", trajectoryId: "t2", now: "2026-09-03T00:00:00.000Z" });
    expect(second.contentHash).toBe(first.contentHash);
  });
});
