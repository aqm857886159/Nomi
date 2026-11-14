import { DETERMINISTIC_PLANNER_PARAMS_POLICY, resolveModelParams } from '../shared/videoCapabilities/resolveModelParams';
import type { StoryboardPlanResult, StoryboardShotDraft } from "./mcpGenerationMultiShot";

/**
 * Deterministic fallback storyboard planner used by the desktop Host when no
 * separate storyboard model is available. It preserves the user's wording,
 * adds no provider-specific parameters, and always returns actionable video
 * shots instead of making the Agent refuse a feasible request.
 */
export function planStoryboardFromScript(input: {
  projectId: string;
  scriptText: string;
  /** Long-form semantic creates use this to prevent a one-shot collapse. */
  minimumShots?: number;
  /** Parsed total duration is advisory context for a richer planner. */
  targetDurationSeconds?: number;
}): StoryboardPlanResult {
  void input.projectId;
  if (typeof input.scriptText !== "string" || !input.scriptText.trim()) {
    throw new Error("剧本文本为空，无法拟镜");
  }
  const targetDurationSeconds = input.targetDurationSeconds;
  if (targetDurationSeconds !== undefined
    && (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0)) {
    throw new Error("目标时长必须是正数（秒）");
  }
  // 第1步保留旧拟镜范围；模型感知的分配留给下一步。
  const { min, max } = DETERMINISTIC_PLANNER_PARAMS_POLICY.durationRange;
  const MAX_SHOTS = 48;
  if (targetDurationSeconds !== undefined && targetDurationSeconds > max * MAX_SHOTS) {
    throw new Error(`目标时长超过当前最多 ${MAX_SHOTS} 镜 × ${max} 秒，无法安全拟镜`);
  }
  const normalized = input.scriptText
    .replace(/\r\n?/g, "\n")
    .split(/\n+|(?<=[。！？!?；;])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = normalized.length > 0 ? normalized : [input.scriptText.trim()];
  const fragments: string[] = [];
  for (const part of source) {
    if (part.length <= 240) {
      fragments.push(part);
      continue;
    }
    for (let offset = 0; offset < part.length; offset += 200) {
      const fragment = part.slice(offset, offset + 200).trim();
      if (fragment) fragments.push(fragment);
    }
  }
  const bounded = fragments.slice(0, MAX_SHOTS);
  const minimumShots = Number.isInteger(input.minimumShots)
    ? Math.min(MAX_SHOTS, Math.max(1, Number(input.minimumShots)))
    : 1;
  const requiredShotsForDuration = targetDurationSeconds === undefined
    ? 0
    : Math.max(1, Math.ceil(targetDurationSeconds / max));
  // Preserve every source fragment when it is feasible, while ensuring a
  // target duration has enough provider clips to carry the requested seconds.
  const targetShotCount = Math.max(minimumShots, requiredShotsForDuration, bounded.length);
  if (targetDurationSeconds !== undefined && targetShotCount * min > targetDurationSeconds) {
    throw new Error(`目标时长 ${targetDurationSeconds} 秒不足以容纳 ${targetShotCount} 个镜头（每镜至少 ${min} 秒）`);
  }
  if (targetShotCount > MAX_SHOTS) {
    throw new Error(`拟镜最多支持 ${MAX_SHOTS} 个镜头`);
  }
  // The desktop fallback is intentionally deterministic, but a long-form
  // semantic request still needs a real multi-shot plan. If the user gave one
  // sentence, preserve it while making the progression explicit instead of
  // quietly submitting that sentence as one five-minute clip.
  if (bounded.length > 0 && bounded.length < targetShotCount) {
    const phases = ["开场", "发展", "收束", "余韵"];
    while (bounded.length < targetShotCount) {
      const phase = phases[(bounded.length - 1) % phases.length];
      bounded.push(`${phase}：${source[0]}`);
    }
  }
  const durations = targetDurationSeconds === undefined
    ? undefined
    : (() => {
      const count = bounded.length;
      if (count === 0 || count * min > targetDurationSeconds || count * max < targetDurationSeconds) {
        throw new Error(`无法把目标时长 ${targetDurationSeconds} 秒分配到当前镜头`);
      }
      const base = Math.floor(targetDurationSeconds / count);
      const remainder = targetDurationSeconds - base * count;
      return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
    })();
  const shots: StoryboardShotDraft[] = bounded.map((prompt, index) => ({
    shotId: `shot-${index + 1}`,
    role: "shot",
    included: true,
    prompt,
    ...(durations ? { durationSeconds: resolveModelParams({
      controls: [], intent: { duration: durations[index] }, previousParams: {}, policy: DETERMINISTIC_PLANNER_PARAMS_POLICY,
    }).params.duration as number } : {}),
  }));
  if (shots.length === 0) throw new Error("剧本文本为空，无法拟镜");
  return {
    shots,
    ...(targetDurationSeconds === undefined ? {} : { targetDurationSeconds }),
  };
}
