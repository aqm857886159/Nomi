// 起草一组镜头时的拒收：**每一镜都判完再一起说**，每条说清是哪一镜、哪个模型、哪种方式（2026-11-15）。
//
// ── 它在治哪一类真实故障（方向复盘 `docs/engineering/direction-checks/2026-11-15-agent-turn-stop.md`）──
//
// 11-15 真 App 三题：6 镜草稿里两个首帧镜头写了 `aspectRatio`，准入层遇到第一个就抛，正文只说「这个模式没有比例可选」，
// 不说是哪一镜、哪种方式；文生那几镜其实没问题，模型分不清，于是把比例挪进 `parameters` 再撞一次，第三次被停。
// 根因不在某一句话：准入层**遇到第一个就抛**，而抛出的那一处（比例 / 时长 / 合同编译）不知道自己在第几镜。
// 现在逐镜收集，定位只在这里加——这里是唯一同时知道「第几镜 + 它的模型 + 它的方式」的地方。
//
// 不变量（面板那一行、连败怎么数都不动）：
//   · 只有一镜被拒 → 抛的还是原来那个异常（同一个类、同一个 rejection / problem），正文末尾多一行定位；
//   · 好几镜被拒 → 一个 `DraftShotsRefusal`（仍是 ContractCompilationError），rejection / problem 取最先被拒的那一镜
//     （= 今天会抛的那一个），字段清单按被拒先后排、路径写法不变，定位只放在模型专用的 `where` 里（不进公开信封）；
//   · 不是我们有意的拒收（TypeError、zod 原始异常……）→ 当场原样抛，不收集。
import type { ToolInputIssue } from "../shared/agentLane/toolInputIssues";
import { issuesFromParameterRejection } from "../shared/agentLane/toolInputIssues";
import { ContractCompilationError } from "./executionContract";
import { GenerationRefusal } from "./transportFailure";

/** 一镜在模型眼里的位置：下标与 `shots[]` 一致（从 0 数），其余是它此刻的身份。 */
export type DraftShotLocator = Readonly<{
  index: number;
  title?: string;
  model?: string;
  modeId?: string;
  /** 这种方式在供应商那边叫什么（「首帧」「文生视频」），认得出才给。 */
  vendorTerm?: string;
}>;

type Refusal = ContractCompilationError | GenerationRefusal;

const isRefusal = (error: unknown): error is Refusal => error instanceof ContractCompilationError || error instanceof GenerationRefusal;

/** `shots[2] "雨夜对峙" (volcengine/doubao-seedance-2-5, mode first_frame "首帧")` */
export function draftShotLocatorText(locator: DraftShotLocator, withModel = true): string {
  const title = locator.title?.trim() ? ` "${locator.title.trim()}"` : "";
  const mode = locator.modeId ? `mode ${locator.modeId}${locator.vendorTerm && locator.vendorTerm !== locator.modeId ? ` "${locator.vendorTerm}"` : ""}` : "";
  const identity = [withModel ? locator.model : undefined, mode].filter(Boolean).join(", ");
  return `shots[${locator.index}]${title}${identity ? ` (${identity})` : ""}`;
}

/** 多镜一起被拒：第一个坏镜头的 rejection / problem 原样带着（面板行、下一步提示都按它），正文与清单列全部。 */
export class DraftShotsRefusal extends ContractCompilationError {
  readonly shotIssues: readonly ToolInputIssue[];
  override readonly problem: ContractCompilationError["problem"];

  constructor(message: string, first: Refusal, shotIssues: readonly ToolInputIssue[]) {
    super(message, first instanceof ContractCompilationError ? first.rejection : undefined);
    this.name = "DraftShotsRefusal";
    this.problem = first.problem;
    this.shotIssues = shotIssues;
  }
}

/**
 * 一次起草的逐镜收集器。首建与补镜头共用一个实例：先过「候选合成 + 参考素材」，过了的镜头再过「模型 / 方式 / 参数」，
 * 最后 `finish()` 一次说完。一镜在前一段被拒，后一段就不再判它（它的模型还没定下来）。
 */
export function createDraftShotRefusals() {
  const failures: { locator: DraftShotLocator; error: Refusal }[] = [];
  const passed = new Map<number, DraftShotLocator>();
  const failed = new Set<number>();
  /** 前一段过了的镜头是第几镜（`shotId` 由宿主一次发齐、同一份里唯一）。 */
  const indexByShotId = new Map<string, number>();

  const attempt = <T>(locator: DraftShotLocator, run: () => T): T | undefined => {
    if (failed.has(locator.index)) return undefined;
    try {
      const value = run();
      passed.set(locator.index, locator);
      return value;
    } catch (error) {
      if (!isRefusal(error)) throw error;
      failures.push({ locator, error });
      failed.add(locator.index);
      passed.delete(locator.index);
      return undefined;
    }
  };

  const remember = (shotId: string, index: number): void => { indexByShotId.set(shotId, index); };
  const indexOf = (shotId: string, fallback: number): number => indexByShotId.get(shotId) ?? fallback;

  /** 有镜头被拒就抛（见文件头的不变量）；全过什么都不做。 */
  const finish = (): void => {
    if (failures.length === 0) return;
    const ok = [...passed.values()].sort((left, right) => left.index - right.index);
    const okText = ok.length ? `Shots that passed these checks: ${ok.map((locator) => draftShotLocatorText(locator, false)).join("; ")}.` : "";
    if (failures.length === 1) {
      const only = failures[0]!;
      only.error.message = [only.error.message, `Which shot: ${draftShotLocatorText(only.locator)}.${okText ? ` ${okText}` : ""}`].join("\n");
      throw only.error;
    }
    // 按被拒的先后排（先「候选合成 + 参考」那一段，再「模型 / 方式 / 参数」，各段内按镜头顺序）：
    // 第一条就是今天会抛的那一条，面板读的 problem / 第一条字段因此和今天同一个。
    const ordered = failures;
    const message = [
      `${ordered.length} shots were refused; nothing was drafted. Fix all of them and send the whole draft again:`,
      ...ordered.map(({ locator, error }) => `- ${draftShotLocatorText(locator)}: ${error.message}`),
      ...(okText ? [okText] : []),
    ].join("\n");
    const issues = ordered.flatMap(({ locator, error }) => (error instanceof ContractCompilationError && error.rejection
      ? issuesFromParameterRejection(error.rejection).map((issue) => ({ ...issue, where: draftShotLocatorText(locator) }))
      : []));
    throw new DraftShotsRefusal(message, ordered[0]!.error, issues);
  };

  return { attempt, remember, indexOf, finish };
}

export type DraftShotRefusals = ReturnType<typeof createDraftShotRefusals>;
