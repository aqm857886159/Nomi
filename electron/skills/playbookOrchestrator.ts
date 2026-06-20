// Playbook 编排核心（纯逻辑，可单测）——把「单段 skill」串成「多段 playbook」的状态机。
// 复用 agentChatV2 引擎（不新造 agent）：编排器只决定「按什么顺序、跑哪段、用哪些工具、何时暂停」，
// 真正跑 agent loop 的仍是现有那条链。live 驱动（接 IPC + gate 暂停卡）在有 UI 的切片里接。
// 设计依据：docs/plan/2026-06-19-skill-playbook-system.md §4 + §0.5。
import type { SkillStage, SkillStageModelPref } from "./skillManifestSchema";

/** 阶段缺省暂停：对齐 Flova「每关键阶段暂停审阅」，pause 未声明按 true。 */
function stagePauses(stage: SkillStage): boolean {
  return stage.pause ?? true;
}

/**
 * 按 dependsOn 拓扑排序（Kahn，稳定）：依赖先于被依赖；相互独立的阶段保持声明顺序。
 * 抛错而非静默：① 引用了不存在的阶段 id ② 存在环（注定跑不动的 playbook，加载/启动期就拦）。
 */
export function orderPlaybookStages(stages: SkillStage[]): SkillStage[] {
  const byId = new Map<string, SkillStage>();
  for (const stage of stages) {
    if (byId.has(stage.id)) throw new Error(`playbook 阶段 id 重复：「${stage.id}」`);
    byId.set(stage.id, stage);
  }
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const stage of stages) indegree.set(stage.id, 0);
  for (const stage of stages) {
    for (const dep of stage.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`playbook 阶段「${stage.id}」依赖了不存在的阶段「${dep}」`);
      }
      indegree.set(stage.id, (indegree.get(stage.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), stage.id]);
    }
  }
  // 稳定：按声明顺序取入度为 0 的阶段。
  const ready = stages.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  const ordered: SkillStage[] = [];
  while (ready.length) {
    const id = ready.shift() as string;
    ordered.push(byId.get(id) as SkillStage);
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) {
        // 维持声明顺序插入（找到它在原数组的位置插到 ready 尾部即可，stages 已是声明序）
        ready.push(next);
      }
    }
  }
  if (ordered.length !== stages.length) {
    throw new Error("playbook 阶段存在循环依赖，无法定序");
  }
  return ordered;
}

/** 抽取 SKILL.md 某个 markdown 小标题下的正文段（## / ### 任意级）；找不到返回空串。 */
export function extractMarkdownSection(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const target = heading.trim();
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m && m[2].trim() === target) {
      start = i + 1;
      startLevel = m[1].length;
      break;
    }
  }
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) break; // 同级或更高标题 = 段落结束
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/** 编排器对外暴露的阶段视图（含进度 + 解析后的 pause）。 */
export type PlaybookStageView = {
  id: string;
  goal: string;
  /** 本阶段工具白名单（gate 据此收紧：白名单外的工具拒绝）。空数组=纯规划不调工具。 */
  tools: string[];
  pause: boolean;
  modelPrefs: SkillStageModelPref[];
  /** 0-based 当前阶段序号。 */
  index: number;
  /** 阶段总数。 */
  total: number;
};

export type PlaybookStatus = "running" | "awaiting-confirm" | "done";

export type CompleteResult = { paused: boolean; done: boolean };

/**
 * 一次 playbook 运行的状态机。不可变输入、可变游标；方法语义：
 *  - current()         取当前阶段视图（done 时为 null）
 *  - completeCurrent() 当前阶段的 agent 回合跑完后调用 → 是否需要暂停审阅 / 是否已是最后一段
 *  - advance()         暂停审阅被用户确认后推进到下一段
 */
export class PlaybookRun {
  private readonly stages: SkillStage[];
  private cursor = 0;
  private status: PlaybookStatus = "running";

  constructor(stages: SkillStage[]) {
    this.stages = orderPlaybookStages(stages);
    if (this.stages.length === 0) this.status = "done";
  }

  getStatus(): PlaybookStatus {
    return this.status;
  }

  isDone(): boolean {
    return this.status === "done";
  }

  current(): PlaybookStageView | null {
    if (this.status === "done" || this.cursor >= this.stages.length) return null;
    const stage = this.stages[this.cursor];
    return {
      id: stage.id,
      goal: stage.goal,
      tools: [...stage.tools],
      pause: stagePauses(stage),
      modelPrefs: stage.modelPrefs ? [...stage.modelPrefs] : [],
      index: this.cursor,
      total: this.stages.length,
    };
  }

  /** 当前阶段的 agent 回合跑完。pause 段 → 进入 awaiting-confirm 等用户；否则直接推进。 */
  completeCurrent(): CompleteResult {
    if (this.status === "done") return { paused: false, done: true };
    const stage = this.stages[this.cursor];
    const isLast = this.cursor === this.stages.length - 1;
    if (stagePauses(stage)) {
      this.status = "awaiting-confirm";
      return { paused: true, done: isLast };
    }
    this.moveNext();
    // 用 cursor 判定（而非 this.status === "done"）：早返回已把 status 收窄到非 done，
    // moveNext() 的赋值 TS 不纳入此处控制流，比 status 会报「无重叠」。cursor 是数值，干净。
    return { paused: false, done: this.cursor >= this.stages.length };
  }

  /** 暂停审阅被用户确认 → 推进。仅在 awaiting-confirm 下有效。 */
  advance(): void {
    if (this.status !== "awaiting-confirm") return;
    this.moveNext();
  }

  private moveNext(): void {
    this.cursor += 1;
    this.status = this.cursor >= this.stages.length ? "done" : "running";
  }

  progress(): { index: number; total: number; status: PlaybookStatus } {
    return { index: Math.min(this.cursor, this.stages.length), total: this.stages.length, status: this.status };
  }
}
