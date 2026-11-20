// 「没收尾的算哪种」那张表和它替掉的两份手抄清单逐个状态对账：行为一格不变，只是住处变成一处。
import { expect, it } from "vitest";
import type { ProductionJobStatus } from "../productionRun/productionRunTypes";
import { productionJobOpenAs } from "./productionJobOpenAs";
import { productionJobPhase } from "./productionShotPhase";

const ALL = [
  "planned", "authorization_required", "authorized", "submit_intent_persisted", "submitting", "provider_accepted", "polling",
  "retry_wait", "downloading", "validating_technical", "validating_content", "ready", "adopted", "submission_unknown",
  "reconciling", "needs_attention", "cancel_requested", "cancelled_remote", "detached", "too_late",
] as const satisfies readonly ProductionJobStatus[];
// 新长一个状态没列进来，这一行类型检查就红。
const exhaustive: Exclude<ProductionJobStatus, (typeof ALL)[number]> extends never ? true : false = true;

// 被替掉的那两份，照原样抄在这里当对照（制作认领的两个集合；画布单镜按阶段判的那一条）。
const OLD_CLAIM_IN_FLIGHT = new Set<string>(["submit_intent_persisted", "submitting", "provider_accepted", "polling", "retry_wait", "downloading", "validating_technical", "validating_content"]);
const OLD_CLAIM_UNKNOWN = new Set<string>(["submission_unknown", "reconciling"]);
const oldCanvasBlocking = (status: ProductionJobStatus) =>
  OLD_CLAIM_UNKNOWN.has(status) ? "needs_reconcile" : status === "submit_intent_persisted" || productionJobPhase(status) === "generating" ? "in_flight" : null;

it("covers every job status", () => {
  expect(exhaustive).toBe(true);
  expect(new Set(ALL).size).toBe(ALL.length);
});

it.each(ALL)("%s: same answer as the shot-claim sets it replaced", (status) => {
  const old = OLD_CLAIM_UNKNOWN.has(status) ? "needs_reconcile" : OLD_CLAIM_IN_FLIGHT.has(status) ? "in_flight" : null;
  expect(productionJobOpenAs(status)).toBe(old);
});

it.each(ALL)("%s: same answer as the canvas single-shot blocking rule it replaced", (status) => {
  expect(productionJobOpenAs(status)).toBe(oldCanvasBlocking(status));
});
