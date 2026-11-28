// Agent 工具入参的**一个**边界（pi 1.7.0）：形状校验（`@earendil-works/pi-schema`）、契约 parse（Zod）、连续撞墙，同一处说话、同一处计数。
//
// `pi-ai@1.7.0` 的 `validateToolArguments` 底层直接用 `@earendil-works/pi-schema` 的
// `compile(schema, { formats, coerce: true, unresolvedRefs: "reject" }).parse(...)`。
// 这里复用同一个 `compile` 实例（零 TypeBox 双轨、零正则拆错文）：
//   ① 墙先于一切判（`turn.isOver()` 或连败已满 3 次仍再发）→ 结束本轮（`turn.end()`），请求不再发出；
//   ② 跑工具自己的 `prepareArguments`（容忍畸形输入与 `LaneDomainFailure`）；
//   ③ 用 `pi-schema` 的 `parse(structuredClone(args))` 跑同一把强转+校验尺子（并用 `validateToolArguments` 复核）；
//   ④ 失败 → `issuesFromPiSchema` 直接消费结构化 `ValidationError[]` → `toolArgumentsRejected`，记进熔断。
import { BoundedCache } from '../shared/boundedCache.js';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { compile, type CoercingValidator, type JsonSchema } from '@earendil-works/pi-schema';
import { formats } from '@earendil-works/pi-schema/formats';
import {
  issuesFromPiSchema,
  issuesFromZod,
  zodIssuesOfError,
  type ToolInputIssue,
} from '../shared/agentLane/toolInputIssues.js';
import {
  LaneDomainFailure,
  laneToolPublicFailure,
  renderLaneToolFailure,
  toolArgumentsRejected,
  type LaneToolFailureShape,
} from '../shared/agentLane/laneToolContract.js';
import type { LaneToolOwnFailureCode, LaneToolPublicFailure } from '../shared/agentLane/laneToolFailureEnvelope.js';
import { LANE_REPEATED_FAILURE_BLOCK, type LaneFailureIdentity, type LaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';
import type { LaneToolFailureEvent } from './laneRuntimePort.js';

/** 被熔断拦下的那一次调用的码（立即结果没有 `details`，码写在正文首行）。 */
export const LANE_TOOL_RETRY_STOPPED_CODE = 'tool_retry_stopped' satisfies LaneToolOwnFailureCode;

/** 两种立即结果的首行头。`Validation failed for tool "X"` 也是走查脚本数「参数被拒」的那个头。 */
const rejectedHead = (toolName: string): string => `Validation failed for tool "${toolName}"`;
const stoppedHead = (toolName: string): string => `${toolName} was not run (${LANE_TOOL_RETRY_STOPPED_CODE}). `;

const TURN_OVER_REASON = 'This turn\'s retries are used up: a tool that had failed 3 times in a row was called again after being told to stop, '
  + 'so this turn ended here and this call did not run. Tools become available again with the user\'s next message; '
  + 'then tell the user plainly what kept failing and what you need from them.';

/** 这一轮的停止权（宿主持有，按 run 计）。 */
export type LaneTurnStop = Readonly<{ isOver(): boolean; end(): void }>;

type BoundaryTool = Pick<AgentTool<object>, 'name' | 'parameters' | 'prepareArguments'>;
type ContractSpec = Readonly<{
  name: string;
  schema: { safeParse(value: unknown): { success: boolean; error?: unknown } };
  examples: readonly { arguments: unknown }[];
}>;

export type LaneToolInputBoundary = Readonly<{
  wrap<T extends BoundaryTool>(tools: readonly T[]): T[];
  prepare(toolName: string, args: unknown, run: () => unknown): Promise<string | undefined>;
  settle(toolName: string, isError: boolean, failure: LaneFailureIdentity | undefined): { consecutive: number; stop?: string };
  failureOf(input: Readonly<{ toolName: string; toolCallId?: string; args: unknown; text: string }>): LaneToolPublicFailure | undefined;
}>;

export function createLaneToolInputBoundary(options: Readonly<{
  failures: LaneRepeatedFailureTracker;
  turn: LaneTurnStop;
  specs: readonly ContractSpec[];
  onFailure?: (event: LaneToolFailureEvent) => void;
}>): LaneToolInputBoundary {
  const validators = new WeakMap<object, CoercingValidator>();
  const originals = new Map<string, BoundaryTool>();
  const specByName = new Map(options.specs.map((spec) => [spec.name, spec]));
  const exampleOf = (toolName: string): unknown => specByName.get(toolName)?.examples[0]?.arguments;
  const settledFailures = new BoundedCache<string, LaneToolPublicFailure | undefined>({ maxEntries: 512, order: 'fifo' });

  function validatorOf(schema: object): CoercingValidator {
    const cached = validators.get(schema);
    if (cached) return cached;
    const compiled = compile(schema as JsonSchema, { formats, coerce: true, unresolvedRefs: 'reject' });
    validators.set(schema, compiled);
    return compiled;
  }

  function piVerdict(tool: BoundaryTool, args: unknown): { ok: true; args: unknown } | { ok: false; issues: ToolInputIssue[] } {
    try {
      const validated = validateToolArguments(
        tool as never,
        { type: 'toolCall', id: '', name: tool.name, arguments: args } as never,
      );
      return { ok: true, args: validated };
    } catch {
      const schema = tool.parameters as unknown as object;
      const candidate = structuredClone(args);
      const parsed = validatorOf(schema).parse(candidate);
      if (!parsed.ok) {
        const issues = issuesFromPiSchema(parsed.errors, args, schema);
        if (issues.length > 0) return { ok: false, issues };
      }
      return { ok: false, issues: [{ path: '(root)', kind: 'invalid' }] };
    }
  }

  function settle(toolName: string, isError: boolean, failure: LaneFailureIdentity | undefined): { consecutive: number; stop?: string } {
    const consecutive = options.failures.note(toolName, isError, failure);
    if (!isError) return { consecutive };
    const wall = options.failures.block(toolName);
    options.onFailure?.({
      toolName,
      code: failure?.code ?? 'unknown',
      attempt: consecutive,
      breakerTripped: wall !== null,
      ...(failure?.problem?.code ? { reason: failure.problem.code } : {}),
    });
    return wall && consecutive === LANE_REPEATED_FAILURE_BLOCK ? { consecutive, stop: wall.reason } : { consecutive };
  }

  function reject(toolName: string, failure: LaneToolFailureShape): string {
    const { stop } = settle(toolName, true, failure);
    const text = renderLaneToolFailure(failure);
    return stop ? `${text}\n${stop}` : text;
  }

  function turnOver(toolName: string): never {
    options.turn.end();
    options.onFailure?.({ toolName, code: LANE_TOOL_RETRY_STOPPED_CODE, attempt: LANE_REPEATED_FAILURE_BLOCK, breakerTripped: true });
    throw new Error(`${stoppedHead(toolName)}${TURN_OVER_REASON}`);
  }

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
    const tool = args === undefined ? undefined : originals.get(toolName);
    let own: ReturnType<typeof prepared> | undefined;
    try { own = tool ? prepared(tool, args) : undefined; } catch { own = undefined; }
    if (own && !own.ok) return text.startsWith(own.failure.message) ? laneToolPublicFailure(own.failure) : undefined;
    if (!text.startsWith(rejectedHead(toolName))) return undefined;
    let failure: LaneToolFailureShape | undefined;
    try {
      if (tool && own?.ok) {
        const verdict = piVerdict(tool, own.args);
        failure = verdict.ok
          ? contractFailure(toolName, verdict.args)
          : toolArgumentsRejected(toolName, verdict.issues);
      }
    } catch { failure = undefined; }
    return failure ? laneToolPublicFailure(failure) : { code: 'tool_arguments_invalid' };
  }

  return Object.freeze({
    wrap<T extends BoundaryTool>(tools: readonly T[]): T[] {
      return tools.map((tool) => {
        originals.set(tool.name, tool);
        const prepareArguments = (args: unknown): never => {
          if (options.turn.isOver() || options.failures.block(tool.name)) turnOver(tool.name);
          const own = prepared(tool, args);
          if (!own.ok) throw new Error(reject(tool.name, own.failure));
          const verdict = piVerdict(tool, own.args);
          if (!verdict.ok) {
            throw new Error(reject(tool.name, toolArgumentsRejected(tool.name, verdict.issues, exampleOf(tool.name))));
          }
          return own.args as never;
        };
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
      settledFailures.set(input.toolCallId, failure);
      return failure;
    },
  });
}
