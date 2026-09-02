import { describe, expect, it } from "vitest";
import {
  compilePromptPipe,
  deriveSkillLoadEvents,
  measurePromptCacheUsage,
  type PromptPipeInput,
} from "./promptPipe";

const baseInput = (): PromptPipeInput => ({
  identity: "Nomi identity",
  capability: "Capability contract",
  skillIndex: "Skill metadata",
  skillLoads: [],
  projectContext: "Project facts",
  conversation: "Recent conversation",
  userInput: "Current user request",
});

describe("PromptPipe", () => {
  it("assembles seven ordered layers and keeps the stable prefix byte-identical", () => {
    const first = compilePromptPipe(baseInput());
    const second = compilePromptPipe({ ...baseInput(), projectContext: "A changed project", userInput: "A changed request" });

    expect(first.sections.map((section) => section.id)).toEqual([
      "identity",
      "capability",
      "skill-index",
      "skill-body",
      "project",
      "conversation",
      "user-input",
    ]);
    expect(first.outboundContext.indexOf("Nomi identity")).toBeLessThan(first.outboundContext.indexOf("Current user request"));
    expect(first.stablePrefixHash).toBe(second.stablePrefixHash);
    expect(first.compileHash).not.toBe(second.compileHash);
  });

  it("reports what budget pressure removed instead of silently dropping context", () => {
    const result = compilePromptPipe({
      ...baseInput(),
      projectContext: "project ".repeat(800),
      conversation: "conversation ".repeat(800),
      userInput: "request ".repeat(800),
      budget: { maxBytes: 900 },
    });

    expect(result.outboundContext).toContain("Nomi identity");
    expect(result.budgetWarning).toBeTruthy();
    expect(result.truncatedSections.length + result.omittedSections.length).toBeGreaterThan(0);
    expect(result.budgetWarning).toContain("project");
  });

  it("only reports provider cache evidence when usage contains cached prompt tokens", () => {
    const compiled = compilePromptPipe(baseInput());
    expect(measurePromptCacheUsage(compiled, { promptTokens: 10, completionTokens: 2, cachedPromptTokens: 4, totalTokens: 12 })).toMatchObject({
      evidence: "provider-usage",
      cachedPromptTokens: 4,
    });
    expect(measurePromptCacheUsage(compiled, { promptTokens: 10, completionTokens: 2, cachedPromptTokens: 0, totalTokens: 12 })).toMatchObject({
      evidence: "unknown",
      cachedPromptTokens: 0,
    });
  });

  it("makes a hash or visibility failure explicit and does not inject the body", () => {
    const result = compilePromptPipe({
      ...baseInput(),
      skillLoadFailures: ["video-prompting: canonical content hash mismatch"],
    });
    expect(result.outboundContext).toContain("body was not injected");
    expect(result.warnings).toContain("Skill load failed: video-prompting: canonical content hash mismatch");
    expect(result.outboundContext).not.toContain("SKILL_BODY_MUST_REACH_NEXT_TURN");
  });

  it("proves F-A5 across ledger event, loaded body and next outbound context", () => {
    const ledger = [{
      kind: "tool" as const,
      capability: { id: "skill.read", version: 1 },
      result: {
        loaded: true,
        name: "video-prompting",
        packageVersion: "1.0.0",
        contentHash: "hash-video-prompting",
        body: "SKILL_BODY_MUST_REACH_NEXT_TURN",
      },
    }];
    const events = deriveSkillLoadEvents(ledger);
    const compiled = compilePromptPipe({ ...baseInput(), skillLoads: events });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "video-prompting", contentHash: "hash-video-prompting" });
    expect(compiled.sections.find((section) => section.id === "skill-body")?.content).toContain("SKILL_BODY_MUST_REACH_NEXT_TURN");
    expect(compiled.outboundContext).toContain("SKILL_BODY_MUST_REACH_NEXT_TURN");
  });
});
