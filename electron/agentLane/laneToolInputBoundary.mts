// Agent 工具入参的**一个**边界（2026-11-07）：形状校验、契约 parse、连续撞墙，同一处说话、同一处计数。
//
// 用户原话（11-07）：「经常出现什么参数不对 重试等问题」。根因不在某一个工具，而在 pi 的入参失败有一条
// 我们看不见的路：`prepareToolCall` 里 `validateToolArguments` 一抛，pi 当场合成一条「立即结果」，
// **跳过 `before_tool` 和 `after_tool`**（`harness/execution/tools.js` 的 `immediateError`）——
//   · 熔断只在那两个钩子里记数和拦截，所以形状错了 6 次，计数器一次都没见过；
//   · 模型读到的是 pi 的默认正文：`- shots.0: must not have additional properties`，不说多了哪个键、
//     不给合法值，后面再整份回显入参；
//   · 面板拿不到信封（立即结果的 `details` 恒为空），只能显示「参数不合法」。
//
// pi 留给工具的唯一一个**校验之前**的口子是 `prepareArguments`（官方钩子，同步，`tools.js:25`）。
// 这里把每个工具的 `prepareArguments` 包一层：
//   ① 这个工具已经撞满一堵墙 → 直接拦下，说「这一轮别再发」——墙**先于**一切判，否则错着的调用
//      会一直拿到拒收正文、永远到不了「停」；
//   ② 跑工具自己的 `prepareArguments`（容忍畸形输入的那一步，原样保留）。它自己写好的拒收
//      （`LaneDomainFailure`，如 draft_shots 的「比例只有一个家」）同样是一次立即结果，走同一个出口、同一个计数器；
//   ③ 用 pi **自己的** `validateToolArguments` 判通不通过（尺子只有 pi 那一把，这里不复制它的强转规则）；
//      过了原样返回，pi 随后再校验一次得到同一个结论（编译后的校验器 pi 有缓存）；
//   ④ 不过 → TypeBox 的结构化错误 → `toolInputIssues` 的同一份清单 → `toolArgumentsRejected` 的同一个正文，
//      记进熔断，第 3 次时正文末尾直接带上「停」那句。
// 契约 parse（Zod）和领域准备（`LaneDomainFailure`）那一步在 `before_tool` 里（桌面端口的 `prepare`），
// 由 `prepare` 走同一条：同一个构造器、同一个计数器、同一句「停」。领域准备的拒收是异步、有状态的，
// 面板信封没法按入参重推，只有正文与熔断（见 `failureOf`）。
//
// 面板那一半：立即结果没有 `details`，信封只能**按入参重推**——同一个函数、同一份入参，结论确定。
// `failureOf` 就是给投影层（`LaneModelFacts.toolInputFailure`）的那个读口；正文首行带着码，
// 认的是本文件自己写下的那个头，不是去正则 pi 的英文。
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { AgentHarnessTool } from '@earendil-works/pi-agent-core';
import { Compile } from 'typebox/compile';
import { Value } from 'typebox/value';
import {
  issuesFromTypeBox, issuesFromZod, zodIssuesOfError, type ToolInputIssue, type TypeBoxLikeError,
} from '../shared/agentLane/toolInputIssues.js';
import {
  LaneDomainFailure, laneToolPublicFailure, renderLaneToolFailure, toolArgumentsRejected, type LaneToolFailureShape,
} from '../shared/agentLane/laneToolContract.js';
import type { LaneToolOwnFailureCode, LaneToolPublicFailure } from '../shared/agentLane/laneToolFailureEnvelope.js';
import { LANE_REPEATED_FAILURE_BLOCK, type LaneFailureIdentity, type LaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';
import type { LaneToolFailureEvent } from './laneRuntimePort.js';

/** 被熔断拦下的那一次调用的码（立即结果没有 `details`，码写在正文首行）。 */
export const LANE_TOOL_RETRY_STOPPED_CODE = 'tool_retry_stopped' satisfies LaneToolOwnFailureCode;

/** 两种立即结果的首行头。`Validation failed for tool "X"` 也是走查脚本数「参数被拒」的那个头。 */
const rejectedHead = (toolName: string): string => `Validation failed for tool "${toolName}"`;
const stoppedHead = (toolName: string): string => `${toolName} was not run (${LANE_TOOL_RETRY_STOPPED_CODE}). `;


type BoundaryTool = Pick<AgentHarnessTool<undefined>, 'name' | 'parameters' | 'prepareArguments'>;
type ContractSpec = Readonly<{ name: string; schema: { safeParse(value: unknown): { success: boolean; error?: unknown } }; examples: readonly { arguments: unknown }[] }>;

export type LaneToolInputBoundary = Readonly<{
  /** 给每个工具包上 `prepareArguments`。返回新数组，不改传入的工具对象。 */
  wrap<T extends BoundaryTool>(tools: readonly T[]): T[];
  /**
   * 跑 `before_tool` 里准备那一步（桌面端口的 `prepare`）。它抛出的拒收 → 模型读的那段正文（并记进熔断），认两种：
   * 契约 parse 的 ZodError（同一个格式器），领域写好的 `LaneDomainFailure`（如「标识符 / 版本对不上，先重读」）。
   * 拦截同样是 pi 的立即结果、跳过 `after_tool`，不在这里记数，连发同一个错的模型就永远停不下来。
   * 准备通过返回 `undefined`；认不出的异常原样再抛。
   */
  prepare(toolName: string, args: unknown, run: () => unknown): Promise<string | undefined>;
  /**
   * 执行层（`after_tool`）的一次结果记进同一个熔断：成功清墙；失败计数、发遥测。正好撞满的那一次给回
   * 「停」那句（宿主接在正文后面），模型第 3 次就读到「别再发、去问用户」，而不是等第 4 次被拦下才知道。
   * `consecutive` 是连续失败次数（宿主日志用）。
   */
  settle(toolName: string, isError: boolean, body: string, failure: LaneFailureIdentity | undefined): { consecutive: number; stop?: string };
  /**
   * 一条立即失败的工具结果 → 公开信封（面板用）。只认本边界写下的三种：拦截头、形状 / 契约拒收头、
   * 工具准备步骤自己写好的拒收（按入参重跑那一步，正文以它的 message 开头才认）；别的返回 `undefined`。
   * 2026-11-07 之前 pi 的默认正文（`Validation failed for tool "X":` 不带码）也认：同一份入参重推出同一份清单。
   * 带 `toolCallId` 时记一份：投影每次快照都跑，同一个调用的结论不会变（上限防一条活一整天的 lane 慢慢长表）。
   */
  failureOf(input: Readonly<{ toolName: string; toolCallId?: string; args: unknown; text: string }>): LaneToolPublicFailure | undefined;
}>;

export function createLaneToolInputBoundary(options: Readonly<{
  failures: LaneRepeatedFailureTracker;
  /** 契约（Zod）那一层：重推面板信封、拿示例用。原生工具没有契约，不在这里。 */
  specs: readonly ContractSpec[];
  onFailure?: (event: LaneToolFailureEvent) => void;
}>): LaneToolInputBoundary {
  const validators = new WeakMap<object, ReturnType<typeof Compile>>();
  /** 包之前的那个工具（带它自己的 `prepareArguments`）：重推信封要走和实际执行一样的两步。 */
  const originals = new Map<string, BoundaryTool>();
  const specByName = new Map(options.specs.map((spec) => [spec.name, spec]));
  const exampleOf = (toolName: string): unknown => specByName.get(toolName)?.examples[0]?.arguments;
  const settledFailures = new Map<string, LaneToolPublicFailure | undefined>();

  function validatorOf(schema: object): ReturnType<typeof Compile> {
    const cached = validators.get(schema);
    if (cached) return cached;
    const compiled = Compile(schema as never);
    validators.set(schema, compiled);
    return compiled;
  }

  /**
   * pi 那一把尺子：过了给出 pi 校验后的入参（强转过的那份，契约 parse 收到的就是它）；
   * 不过给出它点名的字段路径（点号写法，根是 `root`）。
   */
  function piVerdict(tool: BoundaryTool, args: unknown): { ok: true; args: unknown } | { ok: false; paths: string[] } {
    try {
      return { ok: true, args: validateToolArguments(tool as never, { type: 'toolCall', id: '', name: tool.name, arguments: args } as never) };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const listed = text.split('\n\nReceived arguments:')[0]!.split('\n').slice(1);
      return { ok: false, paths: listed.flatMap((line) => /^\s+-\s+(.+?):\s/.exec(line)?.[1] ?? []) };
    }
  }

  /**
   * 形状不过时的清单。TypeBox 的错误按 pi 同样「先转换」之后的那份入参算；pi 的强转（null、数字串）
   * 救得回来的字段这里也可能报——所以只留 pi 自己点了名的那些路径下的问题，一条都对不上才全留。
   */
  function shapeIssues(tool: BoundaryTool, args: unknown, piPaths: readonly string[]): ToolInputIssue[] {
    const schema = tool.parameters as unknown as object;
    let converted: unknown = args;
    try { converted = Value.Convert(schema as never, structuredClone(args)); } catch { converted = args; }
    const errors = [...validatorOf(schema).Errors(converted)] as unknown as TypeBoxLikeError[];
    const issues = issuesFromTypeBox(errors, converted, schema);
    const named = issues.filter((issue) => piPaths.some((path) => path === 'root'
      || issue.path === path || issue.path.startsWith(`${path}.`)));
    if (named.length > 0) return named;
    if (issues.length > 0) return issues;
    return [{ path: piPaths[0] ?? '(root)', kind: 'invalid' }];
  }

  /** 一次结果记进熔断（入参边界和执行层共用这一处）：成功清墙；失败计数、发遥测，正好撞满时给回「停」那句。 */
  function settle(toolName: string, isError: boolean, body: string, failure: LaneFailureIdentity | undefined): { consecutive: number; stop?: string } {
    const consecutive = options.failures.note(toolName, isError, body, failure);
    if (!isError) return { consecutive };
    const wall = options.failures.block(toolName);
    options.onFailure?.({ toolName, code: failure?.code ?? 'unknown', attempt: consecutive, breakerTripped: wall !== null });
    return wall && consecutive === LANE_REPEATED_FAILURE_BLOCK ? { consecutive, stop: wall.reason } : { consecutive };
  }

  /** 记一次入参失败；返回模型读的正文（撞满时带上「停」那句）。 */
  function reject(toolName: string, failure: LaneToolFailureShape): string {
    const { stop } = settle(toolName, true, failure.message, failure);
    const text = renderLaneToolFailure(failure);
    return stop ? `${text}\n${stop}` : text;
  }

  function stopped(toolName: string, reason: string): never {
    // 被拦下的这一次**不**再记数：墙已经立着，用户下一句话之前它不会倒。
    options.onFailure?.({ toolName, code: LANE_TOOL_RETRY_STOPPED_CODE, attempt: LANE_REPEATED_FAILURE_BLOCK, breakerTripped: true });
    throw new Error(`${stoppedHead(toolName)}${reason}`);
  }

  /** 工具自己的准备步骤（`prepareArguments`）跑一遍：它写好的拒收给回来，别的异常照旧抛。 */
  function prepared(tool: BoundaryTool, args: unknown): { ok: true; args: unknown } | { ok: false; failure: LaneToolFailureShape } {
    try {
      return { ok: true, args: tool.prepareArguments ? tool.prepareArguments(args) : args };
    } catch (error) {
      if (error instanceof LaneDomainFailure) return { ok: false, failure: error.failure };
      throw error;
    }
  }

  function rejectPreparation(toolName: string, args: unknown, error: unknown): string | undefined {
    if (error instanceof LaneDomainFailure) return reject(toolName, error.failure);
    const zodIssues = zodIssuesOfError(error);
    if (!zodIssues) return undefined;
    return reject(toolName, toolArgumentsRejected(toolName,
      issuesFromZod(zodIssues, args, originals.get(toolName)?.parameters), exampleOf(toolName)));
  }

  function contractFailure(toolName: string, args: unknown): LaneToolFailureShape | undefined {
    const spec = specByName.get(toolName);
    if (!spec) return undefined;
    const parsed = spec.schema.safeParse(args);
    if (parsed.success) return undefined;
    const issues = zodIssuesOfError(parsed.error);
    return issues ? toolArgumentsRejected(toolName, issuesFromZod(issues, args, originals.get(toolName)?.parameters), exampleOf(toolName)) : undefined;
  }

  function derivedFailure({ toolName, args, text }: Readonly<{ toolName: string; args: unknown; text: string }>): LaneToolPublicFailure | undefined {
    if (text.startsWith(stoppedHead(toolName))) return { code: LANE_TOOL_RETRY_STOPPED_CODE };
    // 入参找不到（调用在上一页历史里）就不重推：拿 `undefined` 去校验只会得到一条假的「根不是对象」。
    // 工具已不在这条 lane 上（改名、下线）或它的准备步骤抛了别的，就只剩码。
    const tool = args === undefined ? undefined : originals.get(toolName);
    let own: ReturnType<typeof prepared> | undefined;
    try { own = tool ? prepared(tool, args) : undefined; } catch { own = undefined; }
    if (own && !own.ok) return text.startsWith(own.failure.message) ? laneToolPublicFailure(own.failure) : undefined;
    if (!text.startsWith(rejectedHead(toolName))) return undefined;
    // 形状先、契约后，契约 parse 收的是 pi 校验后的那份——和实际执行的顺序一样。
    let failure: LaneToolFailureShape | undefined;
    try {
      if (tool && own?.ok) {
        const verdict = piVerdict(tool, own.args);
        failure = verdict.ok ? contractFailure(toolName, verdict.args)
          : toolArgumentsRejected(toolName, shapeIssues(tool, own.args, verdict.paths));
      }
    } catch { failure = undefined; }
    return failure ? laneToolPublicFailure(failure) : { code: 'tool_arguments_invalid' };
  }

  return Object.freeze({
    wrap<T extends BoundaryTool>(tools: readonly T[]): T[] {
      return tools.map((tool) => {
        originals.set(tool.name, tool);
        const prepareArguments = (args: unknown): never => {
          const wall = options.failures.block(tool.name);
          if (wall) stopped(tool.name, wall.reason);
          const own = prepared(tool, args);
          if (!own.ok) throw new Error(reject(tool.name, own.failure));
          const verdict = piVerdict(tool, own.args);
          if (!verdict.ok) {
            throw new Error(reject(tool.name, toolArgumentsRejected(tool.name, shapeIssues(tool, own.args, verdict.paths), exampleOf(tool.name))));
          }
          return own.args as never;
        };
        // 原型一起带上：工具对象不保证是字面量，展开会丢掉原型上的方法。
        return Object.assign(Object.create(Object.getPrototypeOf(tool) as object) as T, tool, { prepareArguments });
      });
    },
    async prepare(toolName, args, run) {
      try {
        await run();
        return undefined;
      } catch (error) {
        const rejected = rejectPreparation(toolName, args, error);
        if (rejected === undefined) throw error;
        return rejected;
      }
    },
    settle,
    failureOf(input) {
      if (input.toolCallId === undefined) return derivedFailure(input);
      if (settledFailures.has(input.toolCallId)) return settledFailures.get(input.toolCallId);
      const failure = derivedFailure(input);
      if (settledFailures.size >= 512) settledFailures.delete(settledFailures.keys().next().value!);
      settledFailures.set(input.toolCallId, failure);
      return failure;
    },
  });
}
