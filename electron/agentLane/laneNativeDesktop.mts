// Production resource assembly. The installed libraries own shell execution and OS isolation.
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { createLocalBashOperations, createLocalPowerShellOperations } from '@earendil-works/pi-coding-agent';
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels.js';
import type { ModelAvailabilityFacts } from '../shared/agentCapabilities/modelSpecProjection.js';
import type { SkillRecord } from '../skills/skillStore.js';
import { LANE_WRITE_TOOL_TIMEOUT_MS } from '../shared/agentLane/laneToolContract.js';
import { logWarn } from '../logging/logger.js';
import { openLaneSandbox, sandboxPolicyFor, type LaneBashOperations } from './laneCodingSandbox.mjs';
import { createLaneSkillIndexSource } from './laneSkillCatalog.mjs';
import { createLaneNativeAssembly, type LaneDeferredGroup } from './laneNativeAssembly.mjs';

function adaptLocalShellOperations(local: { exec: LaneBashOperations['exec'] }): LaneBashOperations {
  // Nomi's operation boundary uses milliseconds; the upstream local backend accepts seconds.
  return {
    exec: (command, cwd, options) => local.exec(command, cwd, {
      ...options,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout / 1_000 }),
    }),
  };
}

export async function openLaneNativeDesktop(input: {
  projectDir: string;
  settingsRoot: string;
  skills: readonly SkillRecord[] | (() => readonly SkillRecord[] | Promise<readonly SkillRecord[]>);
  deferredGroups?: readonly LaneDeferredGroup[];
  availableModels?: () => readonly AgentModelEntry[];
  modelAvailability?: (entry: AgentModelEntry) => ModelAvailabilityFacts | undefined;
  platform?: NodeJS.Platform;
}) {
  const source = input.skills;
  const skillIndex = createLaneSkillIndexSource(typeof source === 'function' ? source : () => source);
  await skillIndex.refresh();
  const platform = input.platform ?? process.platform;
  const localOperations = adaptLocalShellOperations(createLocalBashOperations());
  const powerShellOperations = platform === 'win32'
    ? adaptLocalShellOperations(createLocalPowerShellOperations())
    : undefined;
  const sandbox = await openLaneSandbox(sandboxPolicyFor(input), { manager: SandboxManager, localOperations });
  if (sandbox.inactive) {
    logWarn('agent', 'lane-sandbox-inactive', { code: sandbox.inactive.code, detail: sandbox.inactive.detail });
  }
  try {
    const assembly = await createLaneNativeAssembly({
      projectDir: input.projectDir,
      trustedSkillRoots: () => skillIndex.current().trustedSkillRoots,
      sandbox,
      ...(powerShellOperations ? { powerShellOperations } : {}),
      platform,
      bashTimeoutMs: LANE_WRITE_TOOL_TIMEOUT_MS,
      deferredGroups: input.deferredGroups,
      availableModels: input.availableModels,
      modelAvailability: input.modelAvailability,
    });
    return {
      ...assembly,
      skillIndex,
      sandboxActive: sandbox.active,
      ...(sandbox.inactive ? { sandboxInactive: sandbox.inactive } : {}),
      close: () => sandbox.close(),
    };
  } catch (cause) {
    await sandbox.close();
    throw cause;
  }
}
