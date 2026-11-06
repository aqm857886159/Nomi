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
//   ① 先跑工具自己的 `prepareArguments`（容忍畸形输入的那一步，原样保留）；
//   ② 这个工具已经撞满一堵墙 → 直接拦下，说「这一轮别再发」——墙**先于**校验判，否则形状错的调用
//      会一直拿到校验正文、永远到不了「停」；
//   ③ 用 pi **自己的** `validateToolArguments` 判通不通过（尺子只有 pi 那一把，这里不复制它的强转规则）；
//      过了原样返回，pi 随后再校验一次得到同一个结论（编译后的校验器 pi 有缓存）；
//   ④ 不过 → TypeBox 的结构化错误 → `toolInputIssues` 的同一份清单 → `toolArgumentsRejected` 的同一个正文，
//      记进熔断，第 3 次时正文末尾直接带上「停」那句。
// 契约 parse（Zod）那一步在 `before_tool` 里（桌面端口的 `prepare`），由 `rejectContract` 走同一条：
// 同一个构造器、同一个计数器、同一句「停」。
//
// 面板那一半：立即结果没有 `details`，信封只能**按入参重推**——同一个函数、同一份入参，结论确定。
// `failureOf` 就是给投影层（`LaneModelFacts.toolInputFailure`）的那个读口；正文首行带着码，
// 认的是本文件自己写下的那个头，不是去正则 pi 的英文。
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { AgentHarnessTool } from '@earendil-works/pi-agent-core';
import { Compile } from 'typebox/compile';
import { Value } from 'typebox/value';
import {
  issuesFromTypeBox, issuesFromZod, publicToolInputIssues, zodIssuesOfError, type ToolInputIssue, type TypeBoxLikeError,
} from '../shared/agentLane/toolInputIssues.js';
import { renderLaneToolFailure, toolArgumentsRejected, type LaneToolFailureShape } from '../shared/agentLane/laneToolContract.js';
import type { LaneToolPublicFailure } from '../shared/agentLane/laneToolFailureEnvelope.js';
import { LANE_REPEATED_FAILURE_BLOCK, type LaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';
import type { LaneToolFailureEvent } from './laneRuntimePort.js';

/** 被熔断拦下的那一次调用的码（立即结果没有 `details`，码写在正文首行）。 */
export const LANE_TOOL_RETRY_STOPPED_CODE = 'tool_retry_stopped';

/** 两种立即结果的首行头。`Validation failed for tool "X"` 也是走查脚本数「参数被拒」的那个头。 */
const rejectedHead = (toolName: string): string => `Validation failed for tool "${toolName}"`;
const stoppedHead = (toolName: string): string => `${toolName} was not run (${LANE_TOOL_RETRY_STOPPED_CODE}). `;


type BoundaryTool = Pick<AgentHarnessTool<undefined>, 'name' | 'parameters' | 'prepareArguments'>;
type ContractSpec = Readonly<{ name: string; schema: { safeParse(value: unknown): { success: boolean; error?: unknown } }; examples: readonly { arguments: unknown }[] }>;

export type LaneToolInputBoundary = Readonly<{
  /** 给每个工具包上 `prepareArguments`。返回新数组，不改传入的工具对象。 */
  wrap<T extends BoundaryTool>(tools: readonly T[]): T[];
  /**
   * `before_tool` 里契约 parse 抛出的异常 → 模型读的那段正文（并记进熔断）。认不出（不是 ZodError）返回 `undefined`，
   * 由调用方原样再抛。
   */
  rejectContract(toolName: string, args: unknown, error: unknown): string | undefined;
  /**
   * 一条立即失败的工具结果 → 公开信封（面板用）。只认本边界写下的两种头；别的返回 `undefined`。
   * 2026-11-07 之前 pi 的默认正文（`Validation failed for tool "X":` 不带码）也认：同一份入参重推出同一份清单。
   */
  failureOf(input: Readonly<{ toolName: string; args: unknown; text: string }>): LaneToolPublicFailure | undefined;
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

  /** 记一次入参失败；返回模型读的正文（撞满时带上「停」那句）。 */
  function reject(toolName: string, failure: LaneToolFailureShape): string {
    const attempt = options.failures.note(toolName, true, failure.message, failure);
    const wall = options.failures.block(toolName);
    options.onFailure?.({ toolName, code: failure.code, attempt, breakerTripped: wall !== null });
    const text = renderLaneToolFailure(failure);
    return wall ? `${text}\n${wall.reason}` : text;
  }

  function stopped(toolName: string, reason: string): never {
    // 被拦下的这一次**不**再记数：墙已经立着，用户下一句话之前它不会倒。
    options.onFailure?.({ toolName, code: LANE_TOOL_RETRY_STOPPED_CODE, attempt: LANE_REPEATED_FAILURE_BLOCK, breakerTripped: true });
    throw new Error(`${stoppedHead(toolName)}${reason}`);
  }

  function contractFailure(toolName: string, args: unknown): LaneToolFailureShape | undefined {
    const spec = specByName.get(toolName);
    if (!spec) return undefined;
    const parsed = spec.schema.safeParse(args);
    if (parsed.success) return undefined;
    const issues = zodIssuesOfError(parsed.error);
    return issues ? toolArgumentsRejected(toolName, issuesFromZod(issues, args, originals.get(toolName)?.parameters), exampleOf(toolName)) : undefined;
  }

  return Object.freeze({
    wrap<T extends BoundaryTool>(tools: readonly T[]): T[] {
      return tools.map((tool) => {
        originals.set(tool.name, tool);
        const inner = tool.prepareArguments?.bind(tool);
        const prepareArguments = (args: unknown): never => {
          const prepared = inner ? inner(args) : args;
          const wall = options.failures.block(tool.name);
          if (wall) stopped(tool.name, wall.reason);
          const verdict = piVerdict(tool, prepared);
          if (!verdict.ok) {
            throw new Error(reject(tool.name, toolArgumentsRejected(tool.name, shapeIssues(tool, prepared, verdict.paths), exampleOf(tool.name))));
          }
          return prepared as never;
        };
        // 原型一起带上：工具对象不保证是字面量，展开会丢掉原型上的方法。
        return Object.assign(Object.create(Object.getPrototypeOf(tool) as object) as T, tool, { prepareArguments });
      });
    },
    rejectContract(toolName, args, error) {
      const zodIssues = zodIssuesOfError(error);
      if (!zodIssues) return undefined;
      return reject(toolName, toolArgumentsRejected(toolName,
        issuesFromZod(zodIssues, args, originals.get(toolName)?.parameters), exampleOf(toolName)));
    },
    failureOf({ toolName, args, text }) {
      if (text.startsWith(stoppedHead(toolName))) return { code: LANE_TOOL_RETRY_STOPPED_CODE };
      if (!text.startsWith(rejectedHead(toolName))) return undefined;
      // 形状先、契约后，契约 parse 收的是 pi 校验后的那份——和实际执行的顺序一样。
      // 工具已不在这条 lane 上（改名、下线）或它自己的 prepare 抛了，就只剩码。
      // 入参找不到（调用在上一页历史里）就不重推：拿 `undefined` 去校验只会得到一条假的「根不是对象」。
      const tool = args === undefined ? undefined : originals.get(toolName);
      let failure: LaneToolFailureShape | undefined;
      try {
        if (tool) {
          const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
          const verdict = piVerdict(tool, prepared);
          failure = verdict.ok ? contractFailure(toolName, verdict.args)
            : toolArgumentsRejected(toolName, shapeIssues(tool, prepared, verdict.paths));
        }
      } catch { failure = undefined; }
      return {
        code: 'tool_arguments_invalid',
        ...(failure?.allowed ? { allowed: failure.allowed } : {}),
        ...(failure?.issues ? { issues: publicToolInputIssues(failure.issues) } : {}),
      };
    },
  });
}
