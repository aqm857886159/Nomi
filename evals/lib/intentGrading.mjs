// 铁律 ⑩ 模型那一半的评分器（免费段，确定性）：用户说的约束 ↔ Agent 第一次 `draft_shots` 写下的草稿字段。
//
// 读的是 eval:run 拷回来的事件轨迹（`agent.tool.proposed` 带工具参数原文、`agent.tool.completed` 带成败），
// 不读画布终态：画布节点会被档案默认值补齐，拿它比等于把宿主的回落算成 Agent 的功劳。
// 输出沿用 grading.mjs 的 component 三元组 {name, pass, score, reason}，名字带 `intent.` 前缀，聚合时按前缀认。

const VIDEO_TASKS = new Set(["text_to_video", "image_to_video"]);
const IMAGE_TASKS = new Set(["text_to_image", "image_edit"]);
const RATIO = /^\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*$/;

function component(name, pass, reason) {
  return { name: `intent.${name}`, pass, score: pass ? 1 : 0, reason };
}

/** 这一轮 Agent 提议过、且宿主收下了的工具调用（按出现顺序）。 */
export function acceptedToolCalls(events, toolName) {
  const completed = new Map();
  for (const event of events) {
    if (event.type === "agent.tool.completed" && event.payload?.toolCallId) completed.set(event.payload.toolCallId, event.payload.ok === true);
  }
  return events
    .filter((event) => event.type === "agent.tool.proposed" && event.payload?.toolName === toolName)
    .filter((event) => completed.get(event.payload.toolCallId) === true)
    .map((event) => event.payload.args ?? {});
}

/** 新建草稿（不是改草稿）：没有 operationId 的那几次。 */
function createDrafts(events) {
  return acceptedToolCalls(events, "draft_shots").filter((args) => args && typeof args === "object" && args.operationId === undefined);
}

function normalizeRatio(value) {
  const match = typeof value === "string" ? RATIO.exec(value) : null;
  return match ? `${Number(match[1])}:${Number(match[2])}` : undefined;
}

/**
 * 一镜在草稿里写下的意图字段。顶层缺省折进每一镜（逐镜写的优先）——和宿主那一侧
 * `withDraftShotsDefaults` 同一条规则，这里只是读，不改。
 */
export function draftShotFields(args, shot) {
  const taskKind = shot.taskKind ?? args.taskKind;
  const candidate = shot.candidate ?? args.candidate;
  const parameters = shot.parameters && typeof shot.parameters === "object" ? shot.parameters : {};
  const aspect = normalizeRatio(shot.aspectRatio)
    ?? normalizeRatio(parameters.aspect_ratio)
    ?? normalizeRatio(parameters.ratio)
    ?? normalizeRatio(parameters.size);
  return {
    kind: VIDEO_TASKS.has(taskKind) ? "video" : IMAGE_TASKS.has(taskKind) ? "image" : undefined,
    durationSec: typeof shot.durationSec === "number" ? shot.durationSec : undefined,
    aspectRatio: aspect,
    model: candidate?.modelId ?? shot.modelId,
    references: Array.isArray(shot.references) ? shot.references.length : 0,
  };
}

function everyShot(shots, predicate) {
  return shots.length > 0 && shots.every(predicate);
}

/**
 * 一条用例的意图检查。`firstDraft` = 这一轮第一次被宿主收下的新建草稿（首次通过率只看它）。
 * 越界 / 做不到的用例只核诚实：回复里如实说出来，且没有把做不到的值硬写进草稿。
 */
export function gradeIntent(evalCase, output) {
  const expectDraft = evalCase.expect?.draft ?? {};
  const events = output.events || [];
  const drafts = createDrafts(events);
  const first = drafts[0];
  const shots = first ? (Array.isArray(first.shots) ? first.shots : []).map((shot) => draftShotFields(first, shot)) : [];
  const finished = [...events].reverse().find((event) => event.type === "agent.turn.finished");
  const replyText = String(finished?.payload?.finalTextHead || "");
  const checks = [];

  if (expectDraft.count !== undefined) {
    checks.push(component("count", shots.length === expectDraft.count, `drafted=${shots.length} expected=${expectDraft.count}${first ? "" : "（没有被收下的 draft_shots）"}`));
  }
  if (expectDraft.kind) {
    checks.push(component("kind", everyShot(shots, (shot) => shot.kind === expectDraft.kind), `kinds=${shots.map((shot) => shot.kind ?? "?").join(",") || "-"}`));
  }
  if (expectDraft.durationSec !== undefined) {
    checks.push(component("durationSec", everyShot(shots, (shot) => shot.durationSec === expectDraft.durationSec), `durations=${shots.map((shot) => shot.durationSec ?? "-").join(",") || "-"}`));
  }
  if (expectDraft.aspectRatio) {
    const want = normalizeRatio(expectDraft.aspectRatio);
    checks.push(component("aspectRatio", everyShot(shots, (shot) => shot.aspectRatio === want), `aspects=${shots.map((shot) => shot.aspectRatio ?? "-").join(",") || "-"}`));
  }
  if (expectDraft.modelMatch) {
    const pattern = new RegExp(expectDraft.modelMatch, "i");
    checks.push(component("model", everyShot(shots, (shot) => typeof shot.model === "string" && pattern.test(shot.model)), `models=${shots.map((shot) => shot.model ?? "-").join(",") || "-"}`));
  }
  if (expectDraft.references !== undefined) {
    // 没起草也算对：用户要的参考不存在时，停下来说清楚是正确做法。
    const pass = shots.every((shot) => shot.references === expectDraft.references);
    checks.push(component("references", pass, `references=${shots.map((shot) => shot.references).join(",") || "（未起草）"}`));
  }
  if (expectDraft.noGenerate) {
    // 提议过就算：「先别生成」说的是别往花钱那一步走，被宿主拦没拦下不是 Agent 的功劳。
    const generated = events.filter((event) => event.type === "agent.tool.proposed" && event.payload?.toolName === "generate").length;
    checks.push(component("noGenerate", generated === 0, `generate 提议 ${generated} 次`));
  }
  if (expectDraft.honesty) {
    const pattern = new RegExp(expectDraft.honesty, "i");
    checks.push(component("honesty", pattern.test(replyText), replyText ? `reply="${replyText.slice(0, 80)}…"` : "没有回复文字"));
  }
  if (expectDraft.noDraft) {
    checks.push(component("noDraft", drafts.length === 0, `draft_shots 被收下 ${drafts.length} 次`));
  }
  // 收敛：同一句话起草了不止一份新草稿 = 返工（方案 §2 的「反复创建多个方案」）。只报不判，指标里单列。
  return { checks, draftCount: drafts.length };
}

const FIELD_NAMES = ["count", "kind", "durationSec", "aspectRatio", "model", "references", "noGenerate", "honesty", "noDraft"];

/**
 * 意图指标：首次通过率（第一份草稿所有字段都对）、各字段命中率、越界诚实率、平均草稿份数，
 * 按 train / test 分开报（test 是留出集，只看不调）。输入 = eval-score 里的 caseResults。
 */
export function summarizeIntent(caseResults, caseById) {
  const bucket = () => ({ trials: 0, firstPass: 0, drafts: 0, fields: Object.fromEntries(FIELD_NAMES.map((name) => [name, { hit: 0, total: 0 }])) });
  const splits = { all: bucket(), train: bucket(), test: bucket() };
  for (const result of caseResults) {
    const split = caseById.get(result.caseId)?.split === "test" ? "test" : "train";
    for (const trial of result.trialsDetail) {
      const intent = (trial.grade.componentResults || []).filter((check) => check.name.startsWith("intent."));
      if (intent.length === 0 || trial.grade.failureReason === "error") continue;
      for (const target of [splits.all, splits[split]]) {
        target.trials += 1;
        if (intent.every((check) => check.pass)) target.firstPass += 1;
        target.drafts += trial.grade.intentDraftCount ?? 0;
        for (const check of intent) {
          const field = target.fields[check.name.slice("intent.".length)];
          if (!field) continue;
          field.total += 1;
          if (check.pass) field.hit += 1;
        }
      }
    }
  }
  const rate = (hit, total) => (total ? +(hit / total).toFixed(3) : null);
  const view = (target) => ({
    trials: target.trials,
    firstPassRate: rate(target.firstPass, target.trials),
    meanDraftsPerTrial: target.trials ? +(target.drafts / target.trials).toFixed(2) : null,
    fieldHitRate: Object.fromEntries(Object.entries(target.fields).filter(([, field]) => field.total > 0).map(([name, field]) => [name, rate(field.hit, field.total)])),
    honestyRate: rate(target.fields.honesty.hit, target.fields.honesty.total),
  });
  return { all: view(splits.all), train: view(splits.train), test: view(splits.test) };
}
