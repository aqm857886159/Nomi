import { appFetch } from '../appFetch'
import { prepareLaneSkillContext } from './laneInputPreparation'
import { restoreLaneDraftInputs } from './laneRestoredInput'
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
import { readAgentApprovalPolicy, writeAgentApprovalPolicy } from '../settings/agentApprovalPolicySettings';
import { getSettingsRoot, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { chooseTextModel } from '../ai/textBrainResolver'
import { vendorModelConnection } from '../ai/vendorModelConnection'
import { modelContextWindow } from '../shared/modelContextWindow'
import { NOMI_AGENT_IDENTITY, buildLanguageRule, resolveRequestedSkill } from '../harness/context/agentContext'
import type { SkillRecord } from '../skills/skillStore'
import { getProjectMemory, formatMemoryForPrompt } from '../memory/projectMemory'
import { createDesktopLaneInput, parseLaneComposerContext } from './laneDesktopInput'
import { createDesktopLaneTools } from './laneDesktopTools'
import type { OpenDesktopLaneWorkspace, RunLaneSingleShot } from './laneRuntimePort'
import { createProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { executeLaneReceiptCommand } from './laneReceiptCommands'
import type { ResidentGenerationAdapterFactory } from '../capabilityCore/residentGenerationAdapterFactory'
import { canvasReadSurfaceRuntime } from '../capabilityCore/canvasReadSurfaceRuntime'
import { catalogAvailabilityFor } from '../capabilityCore/modelSpecRead'
import type { ProjectSurfaceSession } from '../capabilityCore/canvasReadSurfaceRegistry'
import { parseLaneCommand } from './laneCommandCodec'
import { readSkillRecords, isSkillSelectableInWorkbench } from '../skills/skillStore'
import { createDesktopLaneTasks } from './laneDesktopTasks'
import { createDesktopLaneSpend } from './laneDesktopSpend'
import { createDesktopLaneAttachments } from './laneDesktopAttachments'
import { readLaneDeclaredDefaults } from './laneDesktopModelDefaults'
import { bindLaneProjectSession } from './laneProjectSession'

/** 选中技能 → 提示词。唯一注入点在岛上（pi 的 `formatSkillInvocation`），这里只是桥（形状手抄，理由见 `feedbackIpc.ts:57`）。 */
function renderSelectedSkillPrompt(skill: SkillRecord): Promise<string> {
  const native = createRequire(__filename)('./laneNativeLoader.cjs') as { renderSelectedSkillPrompt(skill: SkillRecord): Promise<string> }
  return native.renderSelectedSkillPrompt(skill)
}

const prepareInput = (context: LaneComposerContext) => prepareLaneSkillContext(context, {
  resolve: key => resolveRequestedSkill({ chatContext: { skill: { key } } }),
  render: renderSelectedSkillPrompt,
})

/**
 * 这一刻的项目记忆。读不出来就当没有——记忆是锦上添花的事实，缺了它 lane 仍然要能说话，
 * 而一个抛出去的异常会让整个回合失败（`getProjectMemory` 会回放事件日志，盘上坏一条就抛）。
 */
function currentProjectMemory(projectId: string): string {
  try { return formatMemoryForPrompt(getProjectMemory(projectId).facts) } catch { return '' }
}

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
    session: ProjectSurfaceSession
    workspace: LaneWorkspaceHandle
    configure(context: LaneComposerContext): Promise<void>
    setPolicy(policy: LaneComposerContext['approvalPolicy']): void
    receipts: ReturnType<typeof createProjectAgentProposalReceiptService>
  } | undefined
  function validate(event: IpcMainInvokeEvent) {
    if (!current) throw new Error('agent_lane_closed')
    surface.surfaceCapture.assertProjectSession(event, current.session)
  }

  return {
    validate,
    restoreInput: (workspace, entries) => {
      // pi already cancelled these inputs. Never borrow another project's asset resolver,
      // and never turn that completed cancellation into a failure that loses the input.
      if (!current || current.workspace !== workspace) return structuredClone(entries)
      return restoreLaneDraftInputs(entries, claims => resolveProjectAgentAttachmentClaims(current!.binding.projectId, claims))
    },
    singleShot: async (event, wire, signal) => {
      const request = wire as { prompt?: unknown; projectId?: unknown; context?: unknown }
      const command = parseLaneCommand({ kind: 'prompt', text: request.prompt })
      if (command.kind !== 'prompt') throw new Error('agent_lane_invalid_command')
      const selection = canvasReadSurfaceRuntime.registry.getCommittedProjectSelection()
      if (!selection || (request.projectId !== undefined && request.projectId !== selection.projectId)) throw new Error('project_binding_stale')
      const binding = { projectId: selection.projectId, immutableProjectUuid: selection.immutableProjectUuid, projectGeneration: selection.projectGeneration }
      const session = surface.surfaceCapture.openProjectSession(event, binding)
      const sessionSignal = canvasReadSurfaceRuntime.registry.resolveProjectSession(session).signal
      const actionSignal = AbortSignal.any([signal, sessionSignal])
      const context = parseLaneComposerContext(request.context)
      const model = selectModel(context.model)
      const input = createDesktopLaneInput({ projectId: binding.projectId,
        capture: () => context, prepare: prepareInput, activate: () => undefined, model: () => model })
      const { runLaneSingleShot } = createRequire(__filename)('./laneNativeLoader.cjs') as { runLaneSingleShot: RunLaneSingleShot }
      const result = await runLaneSingleShot({ fetch: appFetch, model: model.config, prompt: command.text, input, signal: actionSignal,
        systemPrompt: [buildLanguageRule(), NOMI_AGENT_IDENTITY].filter(Boolean).join('\n\n'),
        systemPromptClosing: buildLanguageRule() })
      actionSignal.throwIfAborted()
      surface.surfaceCapture.assertProjectSession(event, session)
      return result
    },
    openWorkspace: async (event, wire) => {
      const request = wire as { binding?: ProjectBinding; model?: LaneComposerContext['model'] }
      const binding = request.binding!
      assertProjectAgentBinding(binding)
      const session = surface.surfaceCapture.openProjectSession(event, binding)
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
      // 权限档是**用户设置**，不是这条 lane 的会话状态：开项目的那一刻就按主进程持有的那份权威值起，
      // 不再从硬编码默认档起、等渲染层把它推上来（那一小段时间里主进程答的是别人的档位）。
      let composer: LaneComposerContext = parseLaneComposerContext({
        ...(request.model ? { model: request.model } : {}), approvalPolicy: readAgentApprovalPolicy(),
      })
      let activeInput = composer
      // Credentials are resolved on send. Opening a project must always permit reading its saved conversation.
      let selected: ReturnType<typeof selectModel> | undefined
      const receipts = createProjectAgentProposalReceiptService({ projectRoot: projectDir, binding })
      let workspace: LaneWorkspaceHandle | undefined
      const tasks = createDesktopLaneTasks(binding.projectId, () => workspace?.refreshTasks())
      const spend = createDesktopLaneSpend(binding.projectId, () => workspace?.refreshSpend())
      let ports: ReturnType<typeof createDesktopLaneTools>
      try { ports = createDesktopLaneTools({ session, binding, surface, context: () => activeInput, receipts, generationFactory, spendCard: spend,
        // 与下面 `approval.policy` 同一个来源（`composer`，不是 `activeInput`）：档位是「用户现在
        // 选的那一档」，切完下一次调用就该照它走，而不是等下一条消息把快照带进来。
        approvalPolicy: () => composer.approvalPolicy,
        onTaskCreated: async (call, result) => {
          if (!workspace || !result || typeof result !== 'object') return
          const value = result as Record<string, unknown>
          const runId = typeof value.runId === 'string' ? value.runId : typeof value.operationId === 'string' ? value.operationId : undefined
          if (!runId || !tasks.resolve(runId)) return
          await workspace.appendTaskNote({ productionRunId: runId, operationId: call.toolCallId })
        },
      }) } catch (error) { tasks.dispose(); spend.dispose(); throw error }
      // 项目记忆与技能库一样是「每一刻都可能变的事实」：用户在记忆折叠里删一条、锁一个节点，
      // 或者 Agent 自己写下一条偏好，都发生在这条 lane 活着的时候。所以这里**不预先算好**——
      // 读放在下面 `systemPrompt` 的函数体里，由宿主在每个回合边界求值一次。
      const input = createDesktopLaneInput({ projectId: binding.projectId,
        capture: () => composer, prepare: prepareInput, activate: (context) => { activeInput = context }, model: () => selected })
      try {
        const { openDesktopLaneWorkspace } = createRequire(__filename)('./laneNativeLoader.cjs') as { openDesktopLaneWorkspace: OpenDesktopLaneWorkspace }
        workspace = await openDesktopLaneWorkspace({ projectDir, fetch: appFetch,
          // 给函数不给快照（下同）：用户在 Agent 面板旁边导入一个技能包、或者让 Agent 自己写一个落盘，
          // 都发生在这条 lane 活着的时候。传数组时那条技能要关掉项目重开才出现（2026-09-11 走查）。
          native: { settingsRoot: getSettingsRoot(), skills: async () => (await readSkillRecords()).filter(isSkillSelectableInWorkbench) },
          // 可用性三件由这一层给：它本来就持有目录，而 lane 模块不许 import 目录（分层）。
          modelAvailability: (entry) => catalogAvailabilityFor(entry.vendor, entry.modelId),
          // 给函数不给快照：回复语言铁律跟界面语言走、项目记忆跟用户和 Agent 的改动走，
          // 这条已经开着的 lane 下一个回合就该跟上，而不是等冷启动（2026-09-11 走查）。
          // 宿主每个回合求值一次（`laneHost` 的 `systemPromptForRun`），不是每次模型请求。
          systemPrompt: () => [buildLanguageRule(), NOMI_AGENT_IDENTITY, currentProjectMemory(binding.projectId)]
            .filter(Boolean).join('\n\n'),
          systemPromptClosing: buildLanguageRule,
          tools: ports.tools, toolLifecycle: ports.toolLifecycle, input,
          tasks: tasks.resolve,
          spend: spend.resolve,
          attachments: createDesktopLaneAttachments(binding.projectId),
          modelDefaults: readLaneDeclaredDefaults,
          approval: { hasUserInterface: true, policy: () => composer.approvalPolicy },
        })
      } catch (error) { ports.dispose(); tasks.dispose(); spend.dispose(); throw error }
      const opened = workspace
      const owner = { binding, session, workspace, receipts,
        // 用户切档 → 主进程那份权威值当场跟着变（写口只有这一个）。外部 MCP、全自动调度、
        // 下一次开项目读到的都是它；调用方永远没有第二条路把档位「说」出来。
        setPolicy: (policy: LaneComposerContext['approvalPolicy']) => {
          composer = { ...composer, approvalPolicy: writeAgentApprovalPolicy(policy) }
        },
        configure: async (next: LaneComposerContext) => {
          const model = selectModel(next.model)
          if (JSON.stringify(selected?.config) !== JSON.stringify(model.config)) {
            const previous = selected
            selected = model
            try { await opened.configureModel(model.config) } catch (error) { selected = previous; throw error }
          }
          composer = { ...next, approvalPolicy: writeAgentApprovalPolicy(next.approvalPolicy) }
        },
      }
      let exposed: LaneWorkspaceHandle
      try {
        exposed = bindLaneProjectSession(opened, canvasReadSurfaceRuntime.registry, session, () => {
          ports.dispose(); tasks.dispose(); spend.dispose(); if (current === owner) current = undefined
        })
      } catch (error) {
        try { await opened.close() } finally { ports.dispose(); tasks.dispose(); spend.dispose() }
        throw error
      }
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
