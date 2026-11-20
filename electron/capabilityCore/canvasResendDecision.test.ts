// 「再发一次」的决定号：只在发它的那个窗口、那个项目、那个节点、那段时间里、对号里那几笔有效；用过就不能再给另一次提交用。
import { expect, it } from "vitest";
import { createResendDecisions, installResendDecisions, resendDecisionCovers } from "./canvasResendDecision";

const scope = { projectId: "p1", nodeId: "n1", senderId: 7 };
const release = [{ runId: "run-a", jobId: "job-a" }];

function minted(now = { at: 0 }) {
  const decisions = createResendDecisions(() => now.at);
  const decision = decisions.mint(scope, { inFlight: new Map([["run-b", "job-b"]]), release });
  return { decisions, decision, now };
}

it("covers only the listed job, in the same project and window", () => {
  const { decisions, decision } = minted();
  expect(decisions.covers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(true);
  expect(decisions.covers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-other" })).toBe(false);
  expect(decisions.covers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-b", jobId: "job-b" })).toBe(false);
  expect(decisions.covers(decision.decisionId, { projectId: "p2", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(false);
  expect(decisions.covers(decision.decisionId, { projectId: "p1", senderId: 8, runId: "run-a", jobId: "job-a" })).toBe(false);
  expect(decisions.covers("made-up", { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(false);
  expect(decisions.covers(undefined, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(false);
});

it("take binds the decision to one submit; another node, window, project or a fabricated id gets nothing", () => {
  const { decisions, decision } = minted();
  expect(decisions.take(decision.decisionId, { ...scope, nodeId: "n2", runRecordId: "r1" })).toBeUndefined();
  expect(decisions.take(decision.decisionId, { ...scope, senderId: 8, runRecordId: "r1" })).toBeUndefined();
  expect(decisions.take(decision.decisionId, { ...scope, projectId: "p2", runRecordId: "r1" })).toBeUndefined();
  expect(decisions.take("made-up", { ...scope, runRecordId: "r1" })).toBeUndefined();
  expect(decisions.take(decision.decisionId, { ...scope, runRecordId: "r1" })?.inFlight).toEqual(new Map([["run-b", "job-b"]]));
  // 同一次提交的重放还认；换一次提交就不认，放行旧单也不再认。
  expect(decisions.take(decision.decisionId, { ...scope, runRecordId: "r1" })).toBeDefined();
  expect(decisions.take(decision.decisionId, { ...scope, runRecordId: "r2" })).toBeUndefined();
  expect(decisions.covers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(false);
});

it("expires after thirty minutes and dies with its window", () => {
  const { decisions, decision, now } = minted();
  now.at = 30 * 60 * 1000 - 1;
  expect(decisions.covers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(true);
  now.at = 30 * 60 * 1000;
  expect(decisions.take(decision.decisionId, { ...scope, runRecordId: "r1" })).toBeUndefined();
  const second = minted();
  second.decisions.dropSender(7);
  expect(second.decisions.covers(second.decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(false);
});

it("the trusted release door refuses everything while the capability core is not installed", () => {
  const { decisions, decision } = minted();
  installResendDecisions(null);
  expect(resendDecisionCovers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(false);
  installResendDecisions(decisions);
  expect(resendDecisionCovers(decision.decisionId, { projectId: "p1", senderId: 7, runId: "run-a", jobId: "job-a" })).toBe(true);
  installResendDecisions(null);
});
