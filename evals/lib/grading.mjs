// 评分器(免费段):把 dataset 的 expect 词表翻译成 componentResults。
// GradingResult 三元组 {pass, score, reason} 全系统统一(抄 promptfoo);
// 断言失败(assert)与基础设施错误(error)分开计数(评测方案 §3.1)。

/** 从 EvalOutput 取"本轮创建的节点"=终态节点 − 基线节点。 */
export function createdNodes(output) {
  const baseline = new Set(output.baselineNodeIds || []);
  const nodes = output.terminalState?.nodes || [];
  return nodes.filter((n) => !baseline.has(n.id));
}

function edgesAmongCreated(output) {
  const created = new Set(createdNodes(output).map((n) => n.id));
  return (output.terminalState?.edges || []).filter((e) => created.has(e.source) && created.has(e.target));
}

function component(name, pass, reason) {
  return { name, pass, score: pass ? 1 : 0, reason };
}

/** 通用不变量(每个 case 都查)+ expect 词表逐项。返回 GradingResult。 */
export function gradeCase(evalCase, output) {
  if (output.failureReason === "error") {
    return {
      pass: false,
      score: 0,
      reason: `infra error: ${output.error || "unknown"}`,
      failureReason: "error",
      componentResults: [],
    };
  }
  const expect = evalCase.expect || {};
  const created = createdNodes(output);
  const edges = edgesAmongCreated(output);
  const events = output.events || [];
  const checks = [];

  // —— 通用不变量 ——
  checks.push(component("turnFinished", output.turn?.finished === true && output.turn?.status === "ok", `turn=${output.turn?.status}`));
  const vendorCalls = events.filter((e) => e.type === "vendor.call.requested").length;
  checks.push(component("zeroVendorCalls(评测安全门)", vendorCalls === 0, `vendor.call.requested=${vendorCalls}`));
  checks.push(component("noDeniedTools", (output.turn?.denials || 0) === 0, `denials=${output.turn?.denials || 0}`));

  // —— expect 词表 ——
  if (expect.createdShots) {
    const [min, max] = expect.createdShots;
    checks.push(component("createdShots", created.length >= min && created.length <= max, `created=${created.length} expected=[${min},${max}]`));
  }
  if (expect.kind) {
    // kind 支持 string 或数组:拆镜头产 image 还是 video 是合理分歧(宣传片→video 不算错),
    // 真正的不变量是"不能是 text/audio/3d"。待 S2 产品裁定后可再收紧。
    const allowed = Array.isArray(expect.kind) ? expect.kind : [expect.kind];
    const bad = created.filter((n) => !allowed.includes(n.kind));
    checks.push(component("kind", bad.length === 0, bad.length ? `${bad.length} 个节点 kind∉[${allowed}]` : `kind ∈ [${allowed}]`));
  }
  if (expect.eachPromptMinLen) {
    const bad = created.filter((n) => String(n.prompt || "").trim().length < expect.eachPromptMinLen);
    checks.push(component("eachPromptMinLen", bad.length === 0, bad.length ? `${bad.length} 个节点 prompt < ${expect.eachPromptMinLen} 字` : "prompts ok"));
  }
  if (expect.category) {
    const bad = created.filter((n) => n.categoryId !== expect.category);
    checks.push(component("category", bad.length === 0, bad.length ? `${bad.length} 个节点不在 ${expect.category}` : `all in ${expect.category}`));
  }
  if (typeof expect.minChainEdges === "number") {
    checks.push(component("minChainEdges", edges.length >= expect.minChainEdges, `edges=${edges.length} min=${expect.minChainEdges}`));
  }
  if (typeof expect.maxChainEdges === "number") {
    checks.push(component("maxChainEdges", edges.length <= expect.maxChainEdges, `edges=${edges.length} max=${expect.maxChainEdges}`));
  }
  // tool-args 语义谓词(缺口#4):agent 配的模型/档案必须真实可解析
  const missingMeta = created.filter((n) => !n.meta?.modelKey || !n.meta?.archetype?.id);
  checks.push(component("metaModelValid", missingMeta.length === 0, missingMeta.length ? `${missingMeta.length} 个节点缺 modelKey/archetype` : "meta ok"));

  const failed = checks.filter((c) => !c.pass);
  return {
    pass: failed.length === 0,
    score: checks.length ? +(checks.filter((c) => c.pass).length / checks.length).toFixed(3) : 0,
    reason: failed.length === 0 ? "all checks passed" : failed.map((c) => `${c.name}: ${c.reason}`).join("; "),
    failureReason: failed.length === 0 ? null : "assert",
    componentResults: checks,
  };
}

/** pass@k / pass^k 聚合(Anthropic 概念分层:Task × Trial)。 */
export function aggregateTrials(trialGrades) {
  const k = trialGrades.length;
  const passes = trialGrades.filter((g) => g.pass).length;
  return {
    trials: k,
    passAtK: passes > 0,
    passAllK: passes === k,
    passRate: k ? +(passes / k).toFixed(3) : 0,
    meanScore: k ? +(trialGrades.reduce((s, g) => s + g.score, 0) / k).toFixed(3) : 0,
  };
}
