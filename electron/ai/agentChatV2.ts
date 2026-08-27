import crypto from 'node:crypto';
import type { AgentChatActivity, AgentChatRequest, AgentChatResponse, AgentChatHistoryRequest } from '../harness/agentChatContracts';
import { agentToolsForCapability, agentToolIsInScope, captureAgentChatRequest, captureAgentHistory } from '../harness/agentChatPolicy';
import { agentContextHost, withAgentRuntimePaths } from '../harness/context/agentContextHost';
import { NOMI_AGENT_IDENTITY, buildSkillSystemPrompt, composeAgentSystemPrompt } from '../harness/context/agentContext';
import type { RuntimeTurnHooks, NomiModelConfig } from '../harness/runtime/runtimePort';
import { projectIdFromSessionKey } from '../events/eventLogRepository';
import { getProjectMemory, formatMemoryForPrompt } from '../memory/projectMemory';
import { chooseTextModel } from './textBrainResolver';
import { vendorModelConnection } from './vendorModelConnection';
import { applyProfileToRequestBody, getModelProfile } from './modelProfiles';
import { describeEmptyAgentReply } from './agentError';
import { describeRuntimeError } from './runtimeVendorError';
import { sanitizeForBroadCompat } from './promptSanitize';
import { trim, type JsonRecord } from '../jsonUtils';
import { readNomiLocalAsset } from '../assets/localAssetFile';
import { extractTextFromLocalAsset } from '../files/extractText';
import { buildAgentUserContent, modelSupportsImageInput, modelSupportsPdfInput } from './agentUserContent';

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
  let selectedModel: { id: string; label: string; vendorKey: string } | undefined;
  const runtimeHooks: RuntimeTurnHooks = {
    signal: hooks.abortSignal,
    emit: hooks.emit,
    awaitToolConfirmation: (call, signal) => {
      signal.throwIfAborted();
      if (!agentToolIsInScope(payload, call)) return Promise.resolve({ ok: false, denied: true, message: 'Tool target is outside this request capability' });
      return hooks.awaitToolConfirmation(call, signal);
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
    const contextWindow = meta?.contextWindow;
    const maxOutputTokens = meta?.maxOutputTokens;
    const modelConfig: NomiModelConfig = { ...connection, providerId: vendor.key,
      authType: vendor.authType === 'none' ? 'none' : 'api-key',
      temperature: typeof payload.temperature === 'number' && Number.isFinite(payload.temperature) ? payload.temperature : 0.7,
      ...(typeof contextWindow === 'number' && Number.isInteger(contextWindow) && contextWindow > 0
        ? { contextWindow } : {}),
      ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens >= 1
        ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
    };
    if (connection.kind !== 'anthropic') {
      runtimeHooks.onPayload = (body) => applyProfileToRequestBody(body, getModelProfile(connection.modelId));
    }
    let memoryBlock = '';
    try {
      const projectId = payload.projectId ?? payload.canvasProjectId
        ?? (payload.history.kind === 'persistent' ? projectIdFromSessionKey(payload.history.binding.sessionKey) : null);
      if (projectId) memoryBlock = formatMemoryForPrompt(getProjectMemory(projectId).facts);
    } catch { /* Project facts remain best-effort; conversation persistence is not. */ }
    const systemPrompt = composeAgentSystemPrompt({ identity: NOMI_AGENT_IDENTITY,
      panelSystemPrompt: trim(payload.systemPrompt), skillSystemPrompt: buildSkillSystemPrompt(payload as unknown as JsonRecord), memoryBlock })!;
    const display = sanitizeForBroadCompat(trim(payload.displayPrompt) || trim(payload.prompt));
    const content = await buildAgentUserContent({ prompt: display, attachments,
      supportsImageInput: modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta),
      supportsPdfInput: connection.kind !== 'openai-compatible' && modelSupportsPdfInput(model.modelKey, model.modelAlias, model.meta),
      resolveBytes: (url) => readNomiLocalAsset(url)?.bytes ?? null,
      extractText: (attachment) => extractTextFromLocalAsset(attachment.url, attachment.contentType, attachment.fileName),
    });
    signal.throwIfAborted();
    const parts = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;
    const fullContext = sanitizeForBroadCompat(trim(payload.prompt));
    return { ...paths, model: modelConfig, systemPrompt,
      user: { durableText: parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n'),
        ...(fullContext && fullContext !== display ? { currentContextText: fullContext } : {}),
        images: parts.filter((part) => part.type === 'image').map((part) => ({ mimeType: part.mimeType || 'image/png', data: part.image })),
        pdfs: parts.filter((part) => part.type === 'file').map((part) => ({ fileName: part.fileName, data: part.data })),
      },
      tools: agentToolsForCapability(payload.capability),
      capability: payload.capability === 'single-shot' ? { singleShot: true as const, maxSteps: 1 as const }
        : { maxSteps: payload.capability === 'storyboard' ? 24 as const : 8 as const },
      compaction: { enabled: true },
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
    toolCalls: result.toolCalls, artifacts: [], usage: result.usage, finishReason: result.finishReason };
}
