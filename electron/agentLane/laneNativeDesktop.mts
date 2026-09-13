// Production resource assembly. The installed libraries own shell execution and OS isolation.
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels.js';
import type { SkillRecord } from '../skills/skillStore.js';
import { LANE_WRITE_TOOL_TIMEOUT_MS } from '../shared/agentLane/laneToolContract.js';
import { logWarn } from '../logging/logger.js';
import { openLaneSandbox, sandboxPolicyFor, type LaneBashOperations } from './laneCodingSandbox.mjs';
import { createLaneSkillIndexSource } from './laneInstalledSkills.mjs';
import { createLaneNativeAssembly, type LaneDeferredGroup } from './laneNativeAssembly.mjs';

export async function openLaneNativeDesktop(input: {
  projectDir: string;
  settingsRoot: string;
  /**
   * 已安装的技能。**给函数就是活的**：每个回合重读一次，用户会话中途导入的技能下一个回合就在
   * （见 `laneInstalledSkills.mts` 头部）。给数组仍然合法——影子夹具与单测那样用，它们的技能集不变。
   */
  skills: readonly SkillRecord[] | (() => readonly SkillRecord[]);
  deferredGroups?: readonly LaneDeferredGroup[];
  availableModels?: () => readonly AgentModelEntry[];
}) {
  const source = input.skills;
  const skillIndex = createLaneSkillIndexSource(typeof source === 'function' ? source : () => source);
  // 开 lane 那一刻先取一份：初始系统提示词与第一个回合之前的 `read` 都要用它。
  await skillIndex.refresh();
  const local = createLocalBashOperations();
  // Nomi's operation boundary uses milliseconds; the upstream local backend accepts seconds.
  const localOperations: LaneBashOperations = {
    exec: (command, cwd, options) => local.exec(command, cwd, {
      ...options,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout / 1_000 }),
    }),
  };
  const sandbox = await openLaneSandbox(sandboxPolicyFor(input), { manager: SandboxManager, localOperations });
  // 诊断正文在这里落一次日志，**只在这里**：它是排障证据（打包后 .app 的唯一线索来源），
  // 界面拿的是 `inactive.code` 那一半。没有这一行，用户报「怎么每条命令都问我」时，
  // 我们手上除了「沙箱没起来」四个字之外一个字节都没有。
  if (sandbox.inactive) {
    logWarn('agent', 'lane-sandbox-inactive', { code: sandbox.inactive.code, detail: sandbox.inactive.detail });
  }
  try {
    const assembly = await createLaneNativeAssembly({
      projectDir: input.projectDir,
      trustedSkillRoots: () => skillIndex.current().trustedSkillRoots,
      sandbox,
      bashTimeoutMs: LANE_WRITE_TOOL_TIMEOUT_MS,
      deferredGroups: input.deferredGroups,
      availableModels: input.availableModels,
    });
    return { ...assembly, skillIndex, sandboxActive: sandbox.active,
      ...(sandbox.inactive ? { sandboxInactive: sandbox.inactive } : {}),
      close: () => sandbox.close() };
  } catch (cause) {
    await sandbox.close();
    throw cause;
  }
}
