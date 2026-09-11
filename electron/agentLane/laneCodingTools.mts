import { laneToolModelDescription } from '../shared/agentLane/laneToolContract.js';
// Agent lane · **把 pi 自带的 coding 工具接进来**，一个执行器都不自研。
//
// 用户 2026-09-07 原话：「pi Agent 不本来就是个 coding Agent 吗？我们是不是能够直接把那些
// 工具直接给接进来不就行了？」——所以这个文件里**没有**读文件、写文件、跑命令、搜索的实现。
// 有的只是三件宿主该做的事：
//
//   ① **范围**：每个 operations 方法前加一道路径包容（越界 = 一条带「下一步」的工具错误）；
//   ② **沙箱**：bash 的 `operations` 换成 `laneCodingSandbox` 那一个（照 pi 的 sandbox 示例）；
//   ③ **接口**：pi 的 `AgentTool.execute(id, params, signal, onUpdate)` 与 `AgentHarness` 要的
//      `AgentHarnessTool.execute(id, params, onUpdate, toolContext, invocation, context)`
//      **签名不同**（`pi-agent-core/dist/harness/types.d.ts:78-81` 是 `Omit<AgentTool,"execute"> & {…}`），
//      这里做一次签名转接。转接的是**调用形状**，不是行为——工具对象的其余字段原样带过去。
//
// ── 为什么这些工具不走 `LaneToolSpec` 那条路 ──
//
// `LaneToolSpec` 是给**我们自己的领域能力**用的：zod schema、示例、三条描述通道、effects。
// 把 pi 的 7 个工具翻译成 zod 再翻回 JSON Schema，等于**把 pi 的工具重写一遍**——那正是
// R29 四列表里「我们另写了」那一列必须为空的原因。所以它们保持 pi 的 typebox `parameters`
// 与 pi 的 `description` 原样进请求，我们只在旁边挂一份 `LaneToolEffects`（审批闸与崩溃恢复
// 要读它，而 pi 没有这个概念——**加一层注解不是重写一份实现**）。
import path from 'node:path';
import { createLaneCodingPaths, type LaneTrustedSkillRoots } from './laneCodingPaths.mjs';

import type { AgentHarnessTool } from '@earendil-works/pi-agent-core';

import { laneToolMutates, type LaneToolEffect } from '../shared/agentLane/laneToolContract.js';
import type { LaneBashOperations, LaneSandbox } from './laneCodingSandbox.mjs';

/** pi 的 coding 工具在 lane 里的组身份。延迟装载按组解锁，不按单个工具。 */
export const LANE_CODING_TOOL_NAMES = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'] as const;
export type LaneCodingToolName = (typeof LANE_CODING_TOOL_NAMES)[number];

/**
 * 每个 coding 工具**自己声明**它会造成什么后果。
 *
 * 判据与 `laneTools.mts` 里那条装配期不变量同一条：只读必然 `reversal:'none'`，
 * 写入必然说清怎么收回。`edit`/`write` 是 `undoable`——它们改的是项目目录里的**文件**，
 * 收回的手段是 fs 层的（git / 文稿撤销栈），不是画布那种 `proposal`。**别把它们标成
 * `proposal`**：标错的后果不是报错，是审批卡上写着「你还要再点接受」而其实文件已经改了。
 */
export const LANE_CODING_TOOL_EFFECTS: Readonly<Record<LaneCodingToolName, LaneToolEffect>> = {
  read: 'read',
  grep: 'read',
  find: 'read',
  ls: 'read',
  edit: 'reversible_local',
  write: 'reversible_local',
  bash: 'reversible_local',
};

/**
 * 子进程拿到的环境变量。
 *
 * **API key 类一律不透传**，判据是名字而不是白名单：白名单要求我们预先知道每一个供应商
 * 会用什么变量名，而下一个供应商永远还没加进来。名字里带 KEY / TOKEN / SECRET /
 * CREDENTIAL / PASSWORD 的一律摘掉——宁可摘掉一个无辜的 `MONKEY_PATCH`，
 * 也不要漏掉一个 `DEEPSEEK_API_KEY`（漏掉的症状是它出现在某个 `env | grep` 的工具结果里，
 * 然后原样进模型上下文、进供应商）。
 */
const SECRET_ENV_NAME = /(^|_)(KEY|TOKEN|SECRET|CREDENTIALS?|PASSWORD|PASSWD|AUTH|APIKEY|SESSION)($|_)|API_?KEY/i;

export function sanitizeSpawnEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SECRET_ENV_NAME.test(name)) continue;
    clean[name] = value;
  }
  return clean;
}

/** pi 的 `BashSpawnHook` 形状（`core/tools/bash.d.ts:60-63`）。 */
export interface LaneBashSpawnContext {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
}

/** 把 cwd 钉回项目根、把 key 类变量摘干净。pi 在 spawn 之前调用它。 */
export function laneBashSpawnHook(projectDir: string) {
  return (context: LaneBashSpawnContext): LaneBashSpawnContext => ({
    command: context.command,
    // cwd 不接受模型的意见：pi 会把工具的 cwd 传进来，而那是我们建工具时给的项目根。
    // 钉一次是为了让「换个 cwd 绕过包容」这条路在结构上不存在。
    cwd: path.resolve(projectDir),
    env: sanitizeSpawnEnvironment(context.env),
  });
}

// ── pi 的工具工厂（动态 import，因为 pi 是 ESM-only）──────────────────────

/** pi 那一侧我们要用到的工厂。写成接口是为了让单测能喂假工厂，不必真起 seatbelt。 */
export interface PiCodingToolFactories {
  createReadTool(cwd: string, options?: unknown): PiAgentTool
  createGrepTool(cwd: string, options?: unknown): PiAgentTool
  createFindTool(cwd: string, options?: unknown): PiAgentTool
  createLsTool(cwd: string, options?: unknown): PiAgentTool
  createEditTool(cwd: string, options?: unknown): PiAgentTool
  createWriteTool(cwd: string, options?: unknown): PiAgentTool
  createBashTool(cwd: string, options?: unknown): PiAgentTool
}

/** pi 的 `AgentTool` 结构面（只写我们要读的字段）。 */
export interface PiAgentTool {
  name: string
  label: string
  description: string
  parameters: unknown
  promptSnippet?: string
  promptGuidelines?: readonly string[]
  prepareArguments?(args: unknown): unknown
  executionMode?: 'sequential' | 'parallel'
  replay?: 'never' | 'safe'
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (partial: unknown) => void,
  ): Promise<unknown>
}

export async function loadPiCodingToolFactories(): Promise<PiCodingToolFactories> {
  const pi = await import('@earendil-works/pi-coding-agent');
  // AgentTool wrappers discard promptSnippet/promptGuidelines. Use upstream definitions so
  // the harness adapter and system-prompt contribution consume the same public tool object.
  return {
    createReadTool: pi.createReadToolDefinition,
    createGrepTool: pi.createGrepToolDefinition,
    createFindTool: pi.createFindToolDefinition,
    createLsTool: pi.createLsToolDefinition,
    createEditTool: pi.createEditToolDefinition,
    createWriteTool: pi.createWriteToolDefinition,
    createBashTool: pi.createBashToolDefinition,
  } as unknown as PiCodingToolFactories;
}

// ── 组装 ─────────────────────────────────────────────────────────────────

export interface LaneCodingToolsInput {
  /** 项目根。**同时**是工具的 cwd、包容的边界、沙箱的 allowWrite。三者是同一个值，不许各传各的。 */
  readonly projectDir: string
  /**
   * Main-process installed package roots. Read-only; never inferred from model arguments.
   * 给来源不给快照：用户会在会话中途导入技能，索引与可信根必须同源同刷（`LaneTrustedSkillRoots`）。
   */
  readonly trustedSkillRoots?: LaneTrustedSkillRoots
  /** bash 用的沙箱（`openLaneSandbox` 的产物）。`active:false` 时策略层会把自动放行整档摘掉。 */
  readonly canReadProject?: () => Promise<boolean>
  readonly sandbox: LaneSandbox
  /** 逐工具超时（3c 契约的 `execution.timeoutMs`）。bash 传给 pi；其余工具由 harness 的中止信号管。 */
  readonly bashTimeoutMs: number
  readonly factories: PiCodingToolFactories
  /** 文件读写用的底层实现。缺省 = pi 自己的本地 fs（我们只在外面套包容）。 */
  readonly fileSystem?: LaneCodingFileSystem
}

/** 我们要在 operations 里转发的那几个真实 fs 动作。默认由 `node:fs/promises` 提供。 */
export interface LaneCodingFileSystem {
  readFile(absolutePath: string): Promise<Buffer>
  writeFile(absolutePath: string, content: string): Promise<void>
  access(absolutePath: string): Promise<void>
  mkdir(dir: string): Promise<void>
  stat(absolutePath: string): Promise<{ isDirectory(): boolean }>
  readdir(absolutePath: string): Promise<string[]>
  exists(absolutePath: string): Promise<boolean>
}

async function defaultFileSystem(): Promise<LaneCodingFileSystem> {
  const fs = await import('node:fs/promises');
  return {
    readFile: (absolutePath) => fs.readFile(absolutePath),
    writeFile: (absolutePath, content) => fs.writeFile(absolutePath, content, 'utf8'),
    access: (absolutePath) => fs.access(absolutePath),
    mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }); },
    stat: (absolutePath) => fs.stat(absolutePath),
    readdir: (absolutePath) => fs.readdir(absolutePath),
    exists: async (absolutePath) => await fs.access(absolutePath).then(() => true, () => false),
  };
}

/**
 * pi 的 7 个 coding 工具 → `AgentHarnessTool`。
 *
 * 每个 operations 方法都先过 `createLaneCodingPaths` 的 realpath 包容，所以「越界」这件事在**一个地方**判，
 * 7 个工具、以后再加的工具都自动带着它。
 */
export async function createLaneCodingTools(
  input: LaneCodingToolsInput,
): Promise<AgentHarnessTool<undefined>[]> {
  const projectDir = path.resolve(input.projectDir);
  const fileSystem = input.fileSystem ?? (await defaultFileSystem());
  const paths = await createLaneCodingPaths(projectDir, input.trustedSkillRoots);
  const { factories } = input;
  const readPath = async (target: string) => input.canReadProject && !(await input.canReadProject())
    ? paths.readSkill(target) : paths.read(target);

  const tools: PiAgentTool[] = [
    factories.createReadTool(projectDir, {
      operations: {
        readFile: async (absolutePath: string) => fileSystem.readFile(await readPath(absolutePath)),
        access: async (absolutePath: string) => fileSystem.access(await readPath(absolutePath)),
      },
    }),
    factories.createGrepTool(projectDir, {
      operations: {
        isDirectory: async (absolutePath: string) => (await fileSystem.stat(await paths.read(absolutePath))).isDirectory(),
        readFile: async (absolutePath: string) => (await fileSystem.readFile(await paths.read(absolutePath))).toString('utf8'),
      },
    }),
    factories.createFindTool(projectDir, {
      operations: {
        exists: (absolutePath: string) => paths.readExists(absolutePath),
        // glob 的 cwd 也要过包容：`find` 的 `path` 参数最终落在这里。
        glob: async (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => {
          const { glob } = await import('node:fs/promises');
          const root = await paths.read(cwd);
          const out: string[] = [];
          for await (const entry of glob(pattern, { cwd: root, exclude: options.ignore })) {
            await paths.read(path.resolve(root, String(entry)));
            out.push(String(entry));
            if (out.length >= options.limit) break;
          }
          return out;
        },
      },
    }),
    factories.createLsTool(projectDir, {
      operations: {
        exists: (absolutePath: string) => paths.readExists(absolutePath),
        stat: async (absolutePath: string) => fileSystem.stat(await paths.read(absolutePath)),
        readdir: async (absolutePath: string) => fileSystem.readdir(await paths.read(absolutePath)),
      },
    }),
    factories.createEditTool(projectDir, {
      operations: {
        readFile: async (absolutePath: string) => fileSystem.readFile(await paths.write(absolutePath)),
        writeFile: async (absolutePath: string, content: string) => fileSystem.writeFile(await paths.write(absolutePath), content),
        access: async (absolutePath: string) => fileSystem.access(await paths.write(absolutePath)),
      },
    }),
    factories.createWriteTool(projectDir, {
      operations: {
        writeFile: async (absolutePath: string, content: string) => fileSystem.writeFile(await paths.write(absolutePath), content),
        mkdir: async (dir: string) => fileSystem.mkdir(await paths.write(dir)),
      },
    }),
    factories.createBashTool(projectDir, {
      operations: withBashTimeout(input.sandbox.operations, input.bashTimeoutMs),
      spawnHook: laneBashSpawnHook(projectDir),
      // PI_* 环境变量是给 pi 自己的 CLI 用的（模型名、会话 id）。lane 里没有那个语境，
      // 而它们会把「当前模型是谁」泄进每一个子进程的环境——关掉。
      exposeSessionEnvironment: false,
    }),
  ];

  return tools.map(tool => {
    const adapted = adaptPiTool(tool);
    if (tool.name !== 'read') return adapted;
    return { ...adapted, execute: async (...args: Parameters<typeof adapted.execute>) => {
      const result = await adapted.execute(...args);
      const target = (args[1] as { path: string }).path;
      const skillPath = await paths.readSkill(path.resolve(projectDir, target)).catch(() => undefined);
      if (!skillPath || path.basename(skillPath) !== 'SKILL.md') return result;
      return { ...result, details: { ...(result.details && typeof result.details === 'object' ? result.details : {}), skill: { name: path.basename(path.dirname(skillPath)), path: skillPath } } };
    } };
  });
}

/**
 * 超时的唯一注入点。pi 的 bash schema 里模型可以自己填 `timeout`，而它填的那个值
 * **不该盖过契约的上限**——所以在 operations 这一层取两者的小值。
 */
function withBashTimeout(operations: LaneBashOperations, ceilingMs: number): LaneBashOperations {
  return {
    exec: (command, cwd, options) => {
      if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
        return Promise.reject(new Error('Timeout must be a positive number of seconds.'));
      }
      return operations.exec(command, cwd, {
        ...options,
        timeout: Math.min(options.timeout === undefined ? ceilingMs : options.timeout * 1_000, ceilingMs),
      });
    },
  };
}

/**
 * 签名转接：pi 的 `AgentTool` → harness 的 `AgentHarnessTool`。
 *
 * `AgentHarnessTool = Omit<AgentTool,"execute"> & { execute(id, params, onUpdate, toolContext,
 * invocation, context) }`，所以除了 `execute` 之外**一个字段都不用改**——展开原对象，
 * 只把调用形状换过去。中止信号从 harness 的 `context.abortSignal` 取（pi 的 `AgentTool`
 * 是第三个位置参数），这样「用户按停止」在 coding 工具上和在领域工具上是同一条路。
 */
function adaptPiTool(tool: PiAgentTool): AgentHarnessTool<undefined> {
  const effect = LANE_CODING_TOOL_EFFECTS[tool.name as LaneCodingToolName];
  const adapted = {
    ...tool,
    description: laneToolModelDescription(tool),
    promptGuidelines: [tool.description, ...(tool.promptGuidelines ?? [])],
    // 崩溃恢复敢不敢替我们再跑一次——与 `laneTools.mts` 同一个派生点、同一条判据。
    replay: effect && !laneToolMutates(effect) ? 'safe' : 'never',
    execute: async (
      toolCallId: string,
      params: unknown,
      onUpdate: (partial: never) => void,
      _toolContext: undefined,
      _invocation: unknown,
      context: { abortSignal?: AbortSignal },
    ) => await tool.execute(toolCallId, params, context.abortSignal, onUpdate as (partial: unknown) => void),
  };
  return adapted as unknown as AgentHarnessTool<undefined>;
}

/**
 * bash 那条 system-prompt 贡献（通道②③）。**用 pi 自己的**
 * （`bashToolSystemPromptContribution`，`core/tools/bash.d.ts:10-13`），不另写一份——
 * 另写的那份会在上游改了措辞之后静默漂移，而漂移的症状是模型少知道一件事，没人会发现。
 */
export function codingToolPromptSections(tools: readonly PiAgentTool[]): {
  snippets: string[]
  guidelines: string[]
} {
  const snippets: string[] = [];
  const guidelines: string[] = [];
  for (const tool of tools) {
    if (tool.promptSnippet) snippets.push(`${tool.name}: ${tool.promptSnippet}`);
    for (const line of tool.promptGuidelines ?? []) {
      if (!guidelines.includes(line)) guidelines.push(line);
    }
  }
  return { snippets, guidelines };
}
