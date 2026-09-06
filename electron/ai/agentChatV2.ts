import crypto from 'node:crypto';
import type { AgentChatActivity, AgentChatRequest, AgentChatResponse, AgentChatHistoryRequest } from '../harness/agentChatContracts';
import { agentToolsForRequest, agentToolIsInScope, captureAgentChatRequest, captureAgentHistory, resolveAgentToolProfile } from '../harness/agentChatPolicy';
import { agentContextHost, withAgentRuntimePaths } from '../harness/context/agentContextHost';
import { NOMI_AGENT_IDENTITY, buildLanguageRule, readRequestedSkill, resolveRequestedSkill } from '../harness/context/agentContext';
import { compilePromptPipe, deriveSkillLoadEvents, measurePromptCacheUsage, type CompiledPrompt, type SkillLedgerItem, type SkillLoadEvent } from '../harness/context/promptPipe';
import { projectProvenance } from '../harness/context/provenance';
import { classifyToolAction, evaluateProvenanceAction } from '../harness/context/provenanceActionGuard';
import type { RuntimeTurnHooks, NomiModelConfig } from '../harness/runtime/runtimePort';
import { getProjectMemory, formatMemoryForPrompt } from '../memory/projectMemory';
import { chooseTextModel } from './textBrainResolver';
import { vendorModelConnection } from './vendorModelConnection';
import { applyProfileToRequestBody, getModelProfile } from './modelProfiles';
import { describeEmptyAgentReply } from './agentError';
import { describeRuntimeError } from './runtimeVendorError';
import { sanitizeForBroadCompat } from './promptSanitize';
import { trim, type JsonRecord } from '../jsonUtils';
import { modelContextWindow } from '../shared/modelContextWindow';
import { readNomiLocalAsset } from '../assets/localAssetFile';
import { extractTextFromLocalAsset } from '../files/extractText';
import { buildAgentUserContent, modelSupportsImageInput, modelSupportsPdfInput } from './agentUserContent';
import { formatNomiSkillIndex, listNomiSkillIndexEntries } from '../harness/skillIndex.js';
import { formatAgentContextSnapshot } from '../shared/agentContextSnapshot';
import { workModeInstruction } from './agentWorkModePolicy';
import { findSkillRecord } from '../skills/skillStore';
import { desktopT } from '../i18n';

export type RunAgentChatV2Payload = AgentChatRequest;
export type AgentChatV2Event = AgentChatActivity;
export type AgentChatV2Hooks = Omit<RuntimeTurnHooks, 'signal' | 'emit'> & {
  emit(event: AgentChatActivity): void;
  abortSignal?: AbortSignal;
};

export async function agentChatV2HasHistory(input: AgentChatHistoryRequest): Promise<boolean> {
  const scope = captureAgentHistory(input.history);
  if (scope.kind === 'ephemeral') return false;
  return withAgentRuntimePaths((paths) => agentContextHost.alive(scope, paths));
}

export async function clearAgentChatV2History(input: AgentChatHistoryRequest): Promise<void> {
  await agentContextHost.clear(captureAgentHistory(input.history));
}

export async function seedAgentChatV2History(input: AgentChatHistoryRequest): Promise<void> {
  const scope = captureAgentHistory(input.history);
  if (scope.kind === 'ephemeral') return;
  await withAgentRuntimePaths((paths) => agentContextHost.ensure(scope, { ...paths, legacyBubbles: input.messages }));
}

/** Nomi supplies policy, model identity and host tools; pi alone advances the conversation. */
export async function runAgentChatV2(input: AgentChatRequest, hooks: AgentChatV2Hooks): Promise<AgentChatResponse> {
  const payload = captureAgentChatRequest(input);
  const requestedSkill = resolveRequestedSkill(payload as unknown as JsonRecord);
  const requestedCapabilities = requestedSkill?.manifestError
    ? []
    : requestedSkill?.manifest?.requestedCapabilities;
  const runtimeTools = agentToolsForRequest(payload, requestedCapabilities);
  const resolvedToolProfile = resolveAgentToolProfile(payload);
  const maxSteps = payload.capability === 'storyboard' || resolvedToolProfile === 'production' ? 24 as const : 8 as const;
  let selectedModel: { id: string; label: string; vendorKey: string } | undefined;
  let promptCompilation: CompiledPrompt | undefined;
  const runtimeHooks: RuntimeTurnHooks = {
    signal: hooks.abortSignal,
    emit: hooks.emit,
    awaitToolConfirmation: (call, signal) => {
      signal.throwIfAborted();
      if (!agentToolIsInScope(payload, call, requestedCapabilities)) return Promise.resolve({ ok: false, denied: true, message: 'Tool target is outside this request capability' });
      const guard = evaluateProvenanceAction(classifyToolAction(call.toolName), promptCompilation?.provenance ?? []);
      return hooks.awaitToolConfirmation(call, signal).then((decision) => {
        if (decision.ok || !guard.requiresConfirmation || decision.message) return decision;
        return {
          ...decision,
          code: guard.reasonCode,
          message: desktopT('agent.provenanceConfirmation', {
            sources: guard.taintedSourceRefs.join(', '),
            action: guard.action,
          }),
        };
      });
    },
  };
  const result = await withAgentRuntimePaths((paths) => agentContextHost.run(payload.history, async (signal) => {
    signal.throwIfAborted();
    const attachments = payload.attachments ?? [];
    const wantsRichInput = attachments.some((item) => item.kind === 'image' || item.contentType.toLowerCase().includes('pdf') || item.fileName.toLowerCase().endsWith('.pdf'));
    const { vendor, model, apiKey } = chooseTextModel(trim(payload.agentModelKey), wantsRichInput, trim(payload.agentVendorKey));
    const connection = vendorModelConnection(vendor, model, apiKey);
    selectedModel = { id: connection.modelId, label: model.labelZh || connection.modelId, vendorKey: vendor.key };
    const meta = model.meta as Record<string, unknown> | undefined;
    const contextWindow = modelContextWindow(meta);
    const maxOutputTokens = meta?.maxOutputTokens;
    const modelConfig: NomiModelConfig = { ...connection, providerId: vendor.key,
      authType: vendor.authType === 'none' ? 'none' : 'api-key',
      temperature: typeof payload.temperature === 'number' && Number.isFinite(payload.temperature) ? payload.temperature : 0.7,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens >= 1
        ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
    };
    if (connection.kind !== 'anthropic') {
      runtimeHooks.onPayload = (body) => applyProfileToRequestBody(body, getModelProfile(connection.modelId));
    }
    let memoryBlock = '';
    try {
      const projectId = payload.projectId ?? payload.canvasProjectId
        ?? (payload.history.kind === 'persistent' ? payload.history.binding.project.projectId : null);
      if (projectId) memoryBlock = formatMemoryForPrompt(getProjectMemory(projectId).facts);
    } catch { /* Project facts remain best-effort; conversation persistence is not. */ }
    const display = sanitizeForBroadCompat(trim(payload.displayPrompt) || trim(payload.prompt));
    const content = await buildAgentUserContent({ prompt: display, attachments,
      supportsImageInput: modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta),
      supportsPdfInput: connection.kind !== 'openai-compatible' && modelSupportsPdfInput(model.modelKey, model.modelAlias, model.meta),
      resolveBytes: (url) => readNomiLocalAsset(url)?.bytes ?? null,
      extractText: (attachment) => extractTextFromLocalAsset(attachment.url, attachment.contentType, attachment.fileName),
    });
    signal.throwIfAborted();
    const selectedSkillLoads: SkillLoadEvent[] = requestedSkill && requestedSkill.body
      ? [{ name: requestedSkill.name, packageVersion: requestedSkill.packageVersion, contentHash: requestedSkill.contentHash, body: requestedSkill.body }]
      : [];
    const ledgerSkillLoads = deriveSkillLoadEvents(
      (payload.hostPromptLedger ?? []) as readonly SkillLedgerItem[],
      (reference) => {
        const skill = findSkillRecord(reference.name, reference.name);
        return skill && skill.packageVersion === reference.packageVersion && skill.contentHash === reference.contentHash
          ? skill.body
          : null;
      },
    );
    const requested = readRequestedSkill(payload as unknown as JsonRecord);
    const ledgerRefs = (payload.hostPromptLedger ?? []).flatMap((item) => {
      const candidate = item as SkillLedgerItem;
      return candidate.kind === 'tool' && candidate.capability?.id === 'skill.read' && candidate.skillLoad
        ? [candidate.skillLoad] : [];
    });
    const ledgerFailures = ledgerRefs
      .filter((reference) => !ledgerSkillLoads.some((event) => event.name === reference.name && event.contentHash === reference.contentHash))
      .map((reference) => `${reference.name}: canonical content hash or visibility check failed`);
    const skillLoadFailures = [
      ...(requested.key || requested.name) && !requestedSkill ? [`${requested.key || requested.name}: skill is not available in the canonical catalog`] : [],
      ...ledgerFailures,
    ];
    promptCompilation = compilePromptPipe({
      // Language rules are part of the stable identity prefix. Skill and
      // project text are later sections and cannot change policy precedence.
      identity: [buildLanguageRule(), NOMI_AGENT_IDENTITY, buildLanguageRule()].join('\n\n'),
      capability: [trim(payload.systemPrompt), workModeInstruction(payload.workMode)].filter(Boolean).join('\n\n'),
      skillIndex: formatNomiSkillIndex(listNomiSkillIndexEntries(), { limit: 24 }),
      skillLoads: [...ledgerSkillLoads, ...selectedSkillLoads],
      skillLoadFailures,
      projectContext: memoryBlock,
      conversation: formatAgentContextSnapshot(payload.contextSnapshot),
      userInput: trim(payload.prompt),
    });
    const systemPrompt = promptCompilation.systemPrompt;
    const parts = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;
    const fullContext = sanitizeForBroadCompat([
      trim(payload.prompt),
      formatAgentContextSnapshot(payload.contextSnapshot),
    ].filter(Boolean).join('\n\n'));
    return { ...paths, model: modelConfig, systemPrompt,
      user: { durableText: parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n'),
        ...(fullContext && fullContext !== display ? { currentContextText: fullContext } : {}),
        images: parts.filter((part) => part.type === 'image').map((part) => ({ mimeType: part.mimeType || 'image/png', data: part.image })),
        pdfs: parts.filter((part) => part.type === 'file').map((part) => ({ fileName: part.fileName, data: part.data })),
      },
      tools: runtimeTools,
      capability: payload.capability === 'single-shot' ? { singleShot: true as const, maxSteps: 1 as const }
        : { maxSteps },
      compaction: { enabled: true },
      promptReceipt: {
        compileHash: promptCompilation.compileHash,
        stablePrefixHash: promptCompilation.stablePrefixHash,
        estimatedTokens: promptCompilation.estimatedTokens,
        byteLength: promptCompilation.byteLength,
        warnings: promptCompilation.warnings,
        provenance: promptCompilation.provenance,
        taintedSourceRefs: promptCompilation.taintedSourceRefs,
        ...(promptCompilation.budgetWarning ? { budgetWarning: promptCompilation.budgetWarning } : {}),
      },
    };
  }, runtimeHooks));

  // C has already saved the settled snapshot before any user-facing diagnostic is emitted.
  const diagnostic = result.status === 'finished' && !result.text.trim() && selectedModel
    ? describeEmptyAgentReply(result.finishReason, { modelLabel: selectedModel.label, ...getModelProfile(selectedModel.id) }) : '';
  if (result.status === 'error' && result.error) hooks.emit({ type: 'error', message: describeRuntimeError(result.error, selectedModel?.vendorKey ?? '') });
  if (diagnostic) hooks.emit({ type: 'error', message: diagnostic });
  return { id: `agent-${crypto.randomUUID()}`, text: result.text,
    status: diagnostic ? 'error' : result.status,
    ...(result.status === 'cancelled' ? { raw: { cancelled: true as const } } : {}),
    toolCalls: result.toolCalls, artifacts: [], usage: result.usage, finishReason: result.finishReason,
    ...(result.context ? { context: result.context } : {}),
    ...(promptCompilation ? { promptCache: measurePromptCacheUsage(promptCompilation, result.usage) } : {}),
    ...(promptCompilation?.budgetWarning ? { promptBudgetWarning: promptCompilation.budgetWarning } : {}),
    ...(promptCompilation?.warnings.length ? { promptWarnings: promptCompilation.warnings } : {}),
    ...(promptCompilation ? {
      provenance: projectProvenance(promptCompilation.provenance),
      taintedSourceRefs: promptCompilation.taintedSourceRefs,
    } : {}),
  };
}
