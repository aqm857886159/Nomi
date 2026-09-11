import { appFetch } from '../appFetch'
import { resolveProjectAgentAttachmentClaims } from '../assets/projectAssetStore'
import type { IpcMainInvokeEvent } from 'electron'
import { createRequire } from 'node:module'
import type { MigrateLaneLegacy } from '../shared/agentLane/laneLegacyMigrationContract'
import { desktopT, getDesktopLocale } from '../i18n'
import type { DesktopCanvasReadRuntime } from '../capabilityCore/canvasReadMainRuntime'
import type { LaneIpcDependencies } from './laneIpc'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig'
import type { LaneWorkspaceHandle } from '../shared/agentLane/laneContracts'
import { assertProjectAgentBinding, type ProjectBinding } from '../shared/projectBinding'
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from '../shared/agentCapabilities/capabilityApprovalPolicy';
import { getSettingsRoot, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { chooseTextModel } from '../ai/textBrainResolver'
import { vendorModelConnection } from '../ai/vendorModelConnection'
import { modelContextWindow } from '../shared/modelContextWindow'
import { NOMI_AGENT_IDENTITY, buildLanguageRule, resolveRequestedSkill } from '../harness/context/agentContext'
import { getProjectMemory, formatMemoryForPrompt } from '../memory/projectMemory'
import { createDesktopLaneInput, parseLaneComposerContext } from './laneDesktopInput'
import { createDesktopLaneTools } from './laneDesktopTools'
import type { OpenDesktopLaneWorkspace, RunLaneSingleShot } from './laneRuntimePort'
import { createProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { executeLaneReceiptCommand } from './laneReceiptCommands'
import type { ResidentGenerationAdapterFactory } from '../capabilityCore/residentGenerationAdapterFactory'
import { canvasReadSurfaceRuntime } from '../capabilityCore/canvasReadSurfaceRuntime'
import { parseLaneCommand } from './laneCommandCodec'
import { readSkillRecords, isSkillSelectableInWorkbench } from '../skills/skillStore'
import { createDesktopLaneTasks } from './laneDesktopTasks'

function selectModel(preference: LaneComposerContext['model']) {
  const selected = chooseTextModel(preference?.modelKey ?? '', false, preference?.vendorKey ?? '')
  const { vendor, model, apiKey } = selected
  const connection = vendorModelConnection(vendor, model, apiKey)
  const contextWindow = modelContextWindow(model.meta, connection.modelId)
  const maxOutputTokens = (model.meta as Record<string, unknown> | undefined)?.maxOutputTokens
  const config: NomiModelConfig = {
    ...connection, providerId: vendor.key, authType: vendor.authType === 'none' ? 'none' : 'api-key',
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens >= 1
      ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
    ...(model.tokenPricing ? { tokenPricing: model.tokenPricing } : {}),
    ...(model.free ? { free: true as const } : {}),
  }
  return { model, kind: connection.kind, config }
}

/** Owns desktop identity and domain ports; pi owns conversation execution and persistence. */
export function createDesktopLaneDependencies(surface: DesktopCanvasReadRuntime,
  generationFactory: () => ResidentGenerationAdapterFactory['factory'] | undefined,
): LaneIpcDependencies {
  let current: {
    binding: ProjectBinding
    workspace: LaneWorkspaceHandle
    configure(context: LaneComposerContext): Promise<void>
    setPolicy(policy: LaneComposerContext['approvalPolicy']): void
    receipts: ReturnType<typeof createProjectAgentProposalReceiptService>
  } | undefined

  function validate(event: IpcMainInvokeEvent) {
    if (!current) throw new Error('agent_lane_closed')
    surface.surfaceCapture.captureCommittedCanvasReadPort(event, current.binding)
  }

  return {
    validate,
    restoreInput: (workspace, entries) => {
      if (!current || current.workspace !== workspace) throw new Error('agent_lane_workspace_stale')
      return entries.map((entry) => ({ text: entry.text,
        ...(entry.attachments?.length ? { attachments: resolveProjectAgentAttachmentClaims(current!.binding.projectId, entry.attachments)
          .map((ref, index) => ({ ...ref, version: entry.attachments![index].version })) } : {}),
      }))
    },
    singleShot: async (event, wire, signal) => {
      const request = wire as { prompt?: unknown; projectId?: unknown; context?: unknown }
      const command = parseLaneCommand({ kind: 'prompt', text: request.prompt })
      if (command.kind !== 'prompt') throw new Error('agent_lane_invalid_command')
      const selection = canvasReadSurfaceRuntime.registry.getCommittedProjectSelection()
      if (!selection || (request.projectId !== undefined && request.projectId !== selection.projectId)) throw new Error('project_binding_stale')
      const binding = { projectId: selection.projectId, immutableProjectUuid: selection.immutableProjectUuid, projectGeneration: selection.projectGeneration }
      surface.surfaceCapture.captureCommittedCanvasReadPort(event, binding)
      const context = parseLaneComposerContext(request.context)
      const model = selectModel(context.model)
      const skill = context.skillKey ? resolveRequestedSkill({ chatContext: { skill: { key: context.skillKey } } }) : null
      if (context.skillKey && !skill) throw new Error('agent_skill_unavailable')
      const input = createDesktopLaneInput({ projectId: binding.projectId,
        capture: () => context, activate: () => undefined, model: () => model })
      const { runLaneSingleShot } = createRequire(__filename)('./laneNativeLoader.cjs') as { runLaneSingleShot: RunLaneSingleShot }
      const result = await runLaneSingleShot({ fetch: appFetch, model: model.config, prompt: command.text, input, signal,
        systemPrompt: [buildLanguageRule(), NOMI_AGENT_IDENTITY, context.systemPrompt, skill?.body].filter(Boolean).join('\n\n') })
      signal.throwIfAborted()
      surface.surfaceCapture.captureCommittedCanvasReadPort(event, binding)
      return result
    },
    openWorkspace: async (event, wire) => {
      const request = wire as { binding?: ProjectBinding; model?: LaneComposerContext['model'] }
      const binding = request.binding!
      assertProjectAgentBinding(binding)
      surface.surfaceCapture.captureCommittedCanvasReadPort(event, binding)
      const projectDir = resolveWorkspaceProjectDir(binding.projectId, getWorkspaceRepositoryDeps())
      if (!projectDir) throw new Error('project_identity_unavailable')
      const identity = await ensureWorkspaceProjectIdentity(projectDir)
      if (identity.projectId !== binding.projectId || identity.immutableProjectUuid !== binding.immutableProjectUuid
        || identity.projectGeneration !== binding.projectGeneration) throw new Error('project_binding_stale')
      const { migrateLaneLegacy } = createRequire(__filename)('./laneNativeLoader.cjs') as { migrateLaneLegacy: MigrateLaneLegacy }
      await migrateLaneLegacy({ projectDir, userDataDir: getSettingsRoot(), binding, locale: getDesktopLocale(),
        labels: (locale) => ({ summaryPrefix: desktopT('agent.legacySummary', {}, locale),
          unverifiedToolResult: desktopT('agent.legacyUnverifiedTool', {}, locale) }),
      })
      let composer: LaneComposerContext = parseLaneComposerContext({
        ...(request.model ? { model: request.model } : {}), approvalPolicy: DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
      })
      let activeInput = composer
      // Credentials are resolved on send. Opening a project must always permit reading its saved conversation.
      let selected: ReturnType<typeof selectModel> | undefined
      const receipts = createProjectAgentProposalReceiptService({ projectRoot: projectDir, binding })
      let workspace: LaneWorkspaceHandle | undefined
      const tasks = createDesktopLaneTasks(binding.projectId, () => workspace?.refreshTasks())
      let ports: ReturnType<typeof createDesktopLaneTools>
      try { ports = createDesktopLaneTools({ event, binding, surface, context: () => activeInput, receipts, generationFactory,
        onTaskCreated: async (call, result) => {
          if (!workspace || !result || typeof result !== 'object') return
          const value = result as Record<string, unknown>
          const runId = typeof value.runId === 'string' ? value.runId : typeof value.operationId === 'string' ? value.operationId : undefined
          if (!runId || !tasks.resolve(runId)) return
          await workspace.appendTaskNote({ productionRunId: runId, operationId: call.toolCallId })
        },
      }) } catch (error) { tasks.dispose(); throw error }
      let memory = ''
      try { memory = formatMemoryForPrompt(getProjectMemory(binding.projectId).facts) } catch { /* optional project facts */ }
      const input = createDesktopLaneInput({ projectId: binding.projectId,
        capture: () => composer, activate: (context) => { activeInput = context }, model: () => selected })
      try {
        const { openDesktopLaneWorkspace } = createRequire(__filename)('./laneNativeLoader.cjs') as { openDesktopLaneWorkspace: OpenDesktopLaneWorkspace }
        workspace = await openDesktopLaneWorkspace({ projectDir, fetch: appFetch,
          native: { settingsRoot: getSettingsRoot(), skills: readSkillRecords().filter(isSkillSelectableInWorkbench) },
          // 给函数不给快照：回复语言铁律跟界面语言走，用户中途在设置里切了语言，
          // 这条已经开着的 lane 下一个回合就该改口，而不是等冷启动（2026-09-11 走查）。
          systemPrompt: () => [buildLanguageRule(), NOMI_AGENT_IDENTITY, memory].filter(Boolean).join('\n\n'),
          tools: ports.tools, toolLifecycle: ports.toolLifecycle, input,
          tasks: tasks.resolve,
          approval: { hasUserInterface: true, policy: () => composer.approvalPolicy },
        })
      } catch (error) { ports.dispose(); tasks.dispose(); throw error }
      const opened = workspace
      const owner = { binding, workspace, receipts,
        setPolicy: (policy: LaneComposerContext['approvalPolicy']) => { composer = { ...composer, approvalPolicy: policy } },
        configure: async (next: LaneComposerContext) => {
          const model = selectModel(next.model)
          if (JSON.stringify(selected?.config) !== JSON.stringify(model.config)) {
            const previous = selected
            selected = model
            try { await opened.configureModel(model.config) } catch (error) { selected = previous; throw error }
          }
          const skill = next.skillKey ? resolveRequestedSkill({ chatContext: { skill: { key: next.skillKey } } }) : null
          if (next.skillKey && !skill) throw new Error('agent_skill_unavailable')
          composer = { ...next, systemPrompt: [next.systemPrompt, skill?.body].filter(Boolean).join('\n\n') }
        },
      }
      const exposed = { ...opened, close: async () => {
        try { await opened.close() } finally { ports.dispose(); tasks.dispose(); if (current === owner) current = undefined }
      } }
      owner.workspace = exposed
      current = owner
      return exposed
    },
    updatePolicy: (event, value, workspace) => {
      validate(event)
      if (current!.workspace !== workspace) throw new Error('agent_lane_workspace_stale')
      current!.setPolicy(parseLaneComposerContext({ approvalPolicy: value }).approvalPolicy)
    },
    configure: async (event, wire, workspace) => {
      validate(event)
      if (current!.workspace !== workspace) throw new Error('agent_lane_workspace_stale')
      await current!.configure(parseLaneComposerContext((wire as { context?: unknown }).context))
    },
    receipt: (event, wire, workspace) => {
      validate(event)
      return executeLaneReceiptCommand(current!.receipts, workspace, wire)
    },
  }
}
