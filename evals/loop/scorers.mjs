// 客观打分器(脊梁层)—— 纯 JS .generateScore,机器可判定,零 LLM、零网络。
// 这是「指标三层」里 AI 最可信的那层(见 docs/plan/2026-06-21-self-improving-harness-loop.md §3.2)。
// 半客观层(独立批评 agent + 校准)见 semiObjective.mjs;主观层(创始人抽查)不自动化。
import { createScorer } from "@mastra/core/evals";

export const taskCompletion = createScorer({
  id: "task-completion",
  description: "是否产出最终可播放资产",
}).generateScore(({ run }) => (run.output?.producedAsset ? 1 : 0));

export const errorFree = createScorer({
  id: "error-free",
  description: "无报错为 1,按报错条数衰减",
}).generateScore(({ run }) => 1 / (1 + (run.output?.errors ?? 0)));

export const retryEfficiency = createScorer({
  id: "retry-efficiency",
  description: "重试越少越好(1 次=满分)",
}).generateScore(({ run }) => 1 / Math.max(1, run.output?.retries ?? 1));

export const capabilityCoverage = createScorer({
  id: "capability-coverage",
  description: "该用户需要的能力族,Nomi 实际覆盖了几成",
}).generateScore(({ run }) => {
  const expects = run.output?.expects ?? [];
  const used = new Set(run.output?.usedCapabilities ?? []);
  if (!expects.length) return 1;
  return expects.filter((c) => used.has(c)).length / expects.length;
});

export const connectionValidity = createScorer({
  id: "connection-validity",
  description: "连边是否全部建成(无 skip)",
}).generateScore(({ run }) => ((run.output?.invalidEdges ?? 0) === 0 ? 1 : 0));

// 语义边正确性:参考边是否用了语义正确的模式(character_ref 边用 character_ref,非泛用 reference)。
// 镜像真 Nomi bug 类(边模式语义,见 connection-reference / T8 记忆)。这是 loop 要改进的靶指标。
export const semanticEdgeCorrectness = createScorer({
  id: "semantic-edge-correctness",
  description: "参考边是否用了语义正确的模式(非泛用 reference)",
}).generateScore(({ run }) => {
  const t = run.output ?? {};
  const refEdges = t.refEdges ?? 0;
  return refEdges === 0 ? 1 : (t.semanticCorrectEdges ?? 0) / refEdges;
});

export const OBJECTIVE_SCORERS = [
  taskCompletion,
  errorFree,
  retryEfficiency,
  capabilityCoverage,
  connectionValidity,
  semanticEdgeCorrectness,
];
