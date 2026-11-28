import { laneToolModelDescription } from '../shared/agentLane/laneToolContract.js';
// Agent lane · **把 pi 自带的 coding 工具原样接进来**，一个执行器都不自研（`pi-coding-agent@1.7.0`）。
//
// 1.7.0 起 `pi-agent-core` 的 `AgentTool.execute(id, params, signal, onUpdate)` 与 `pi-coding-agent`
// 工具定义完全同形，0.85.1 时期 6 参数 `AgentHarnessTool` 签名转接胶水已同提交删除；
// 同时在 Windows（`platform === 'win32'`）原生接通 `createPowerShellToolDefinition`（`report.md:52`），
// 与 `bash` 共用同一份 `laneBashSpawnHook`（摘密钥环境变量 + 锁项目根 `cwd`）、超时上限与审批闸策略。
import path from 'node:path';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { createLaneCodingPaths, type LaneTrustedSkillRoots } from './laneCodingPaths.mjs';
import { laneToolMutates, type LaneToolEffect } from '../shared/agentLane/laneToolContract.js';
import type { LaneBashOperations, LaneSandbox } from './laneCodingSandbox.mjs';

/** 跨平台常驻的 7 个 coding 工具名。 */
export const LANE_CODING_TOOL_NAMES = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'] as const;
export const LANE_WINDOWS_CODING_TOOL_NAMES = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'powershell'] as const;
export type LaneCodingToolName = (typeof LANE_CODING_TOOL_NAMES)[number];
export type AnyLaneCodingToolName = (typeof LANE_WINDOWS_CODING_TOOL_NAMES)[number];

export function laneCodingToolNames(platform: NodeJS.Platform = process.platform): readonly AnyLaneCodingToolName[] {
  return platform === 'win32' ? LANE_WINDOWS_CODING_TOOL_NAMES : LANE_CODING_TOOL_NAMES;
}

export const LANE_CODING_TOOL_EFFECTS: Readonly<Record<AnyLaneCodingToolName, LaneToolEffect>> = {
  read: 'read',
  grep: 'read',
  find: 'read',
  ls: 'read',
  edit: 'reversible_local',
  write: 'reversible_local',
  bash: 'reversible_local',
  powershell: 'reversible_local',
};

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

export interface LaneBashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function laneBashSpawnHook(projectDir: string) {
  return (context: LaneBashSpawnContext): LaneBashSpawnContext => ({
    command: context.command,
    cwd: path.resolve(projectDir),
    env: sanitizeSpawnEnvironment(context.env),
  });
}

export interface PiCodingToolFactories {
  createReadTool(cwd: string, options?: unknown): PiAgentTool;
  createGrepTool(cwd: string, options?: unknown): PiAgentTool;
  createFindTool(cwd: string, options?: unknown): PiAgentTool;
  createLsTool(cwd: string, options?: unknown): PiAgentTool;
  createEditTool(cwd: string, options?: unknown): PiAgentTool;
  createWriteTool(cwd: string, options?: unknown): PiAgentTool;
  createBashTool(cwd: string, options?: unknown): PiAgentTool;
  createPowerShellTool?(cwd: string, options?: unknown): PiAgentTool;
}

export interface PiAgentTool {
  name: string;
  label: string;
  description: string;
  parameters: object;
  promptSnippet?: string;
  promptGuidelines?: readonly string[];
  prepareArguments?(args: unknown): unknown;
  executionMode?: 'sequential' | 'parallel';
  replay?: 'never' | 'safe';
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (partial: AgentToolResult<unknown>) => void,
  ): Promise<AgentToolResult<unknown>>;
}

export async function loadPiCodingToolFactories(): Promise<PiCodingToolFactories> {
  const pi = await import('@earendil-works/pi-coding-agent');
  return {
    createReadTool: pi.createReadToolDefinition,
    createGrepTool: pi.createGrepToolDefinition,
    createFindTool: pi.createFindToolDefinition,
    createLsTool: pi.createLsToolDefinition,
    createEditTool: pi.createEditToolDefinition,
    createWriteTool: pi.createWriteToolDefinition,
    createBashTool: pi.createBashToolDefinition,
    createPowerShellTool: pi.createPowerShellToolDefinition,
  } as unknown as PiCodingToolFactories;
}

export interface LaneCodingToolsInput {
  readonly projectDir: string;
  readonly trustedSkillRoots?: LaneTrustedSkillRoots;
  readonly canReadProject?: () => Promise<boolean>;
  readonly sandbox: LaneSandbox;
  readonly powerShellOperations?: LaneBashOperations;
  readonly platform?: NodeJS.Platform;
  readonly bashTimeoutMs: number;
  readonly factories: PiCodingToolFactories;
  readonly fileSystem?: LaneCodingFileSystem;
}

export interface LaneCodingFileSystem {
  readFile(absolutePath: string): Promise<Buffer>;
  writeFile(absolutePath: string, content: string): Promise<void>;
  access(absolutePath: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  stat(absolutePath: string): Promise<{ isDirectory(): boolean }>;
  readdir(absolutePath: string): Promise<string[]>;
  exists(absolutePath: string): Promise<boolean>;
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

export type LaneCodingAgentTool = AgentTool<object, unknown> & {
  promptSnippet?: string;
  promptGuidelines?: readonly string[];
};

export async function createLaneCodingTools(
  input: LaneCodingToolsInput,
): Promise<LaneCodingAgentTool[]> {
  const projectDir = path.resolve(input.projectDir);
  const fileSystem = input.fileSystem ?? (await defaultFileSystem());
  const paths = await createLaneCodingPaths(projectDir, input.trustedSkillRoots);
  const { factories } = input;
  const platform = input.platform ?? process.platform;
  const readPath = async (target: string) => input.canReadProject && !(await input.canReadProject())
    ? paths.readSkill(target)
    : paths.read(target);

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
      exposeSessionEnvironment: false,
    }),
  ];

  if (platform === 'win32' && factories.createPowerShellTool) {
    tools.push(
      factories.createPowerShellTool(projectDir, {
        ...(input.powerShellOperations
          ? { operations: withBashTimeout(input.powerShellOperations, input.bashTimeoutMs) }
          : {}),
        spawnHook: laneBashSpawnHook(projectDir),
        exposeSessionEnvironment: false,
      }),
    );
  }

  return tools.map((tool) => {
    const annotated = annotatePiTool(tool);
    if (tool.name !== 'read') return annotated;
    return {
      ...annotated,
      execute: async (...args: Parameters<typeof annotated.execute>) => {
        const result = await annotated.execute(...args);
        const target = (args[1] as { path: string }).path;
        const skillPath = await paths.readSkill(path.resolve(projectDir, target)).catch(() => undefined);
        if (!skillPath || path.basename(skillPath) !== 'SKILL.md') return result;
        return {
          ...result,
          details: {
            ...(result.details && typeof result.details === 'object' ? result.details : {}),
            skill: { name: path.basename(path.dirname(skillPath)), path: skillPath },
          },
        };
      },
    };
  });
}

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

function annotatePiTool(tool: PiAgentTool): LaneCodingAgentTool {
  const effect = LANE_CODING_TOOL_EFFECTS[tool.name as AnyLaneCodingToolName];
  return {
    ...tool,
    description: laneToolModelDescription(tool),
    promptGuidelines: [tool.description, ...(tool.promptGuidelines ?? [])],
    executionMode: effect && laneToolMutates(effect) ? 'sequential' : 'parallel',
    replay: effect && !laneToolMutates(effect) ? 'safe' : 'never',
  } as LaneCodingAgentTool;
}

export function codingToolPromptSections(tools: readonly Pick<PiAgentTool, 'name' | 'promptSnippet' | 'promptGuidelines'>[]): {
  snippets: string[];
  guidelines: string[];
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
