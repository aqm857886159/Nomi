import { formatLaneModelDelta } from "./laneModelContext"
import { formatStoryboardRequestTarget } from '../shared/agentCapabilities/generationInvocationContext'
import { agentModelEntrySchema } from "../shared/agentCapabilities/availableModelsSchema"
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Model } from '../catalog/types'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'
import type { OpenLaneOptions } from './laneRuntimePort'
import { PROJECT_AGENT_APPROVAL_MODES, PROJECT_AGENT_SPEND_POLICIES } from '../shared/agentCapabilities/capabilityApprovalPolicy';
import { AGENT_CONTEXT_SNAPSHOT_VERSION, formatAgentContextSnapshot } from '../shared/agentContextSnapshot'
import { resolveProjectAgentAttachmentClaims } from '../assets/projectAssetStore'
import { readNomiLocalAsset } from '../assets/localAssetFile'
import { extractTextFromLocalAsset } from '../files/extractText'
import { buildAgentUserContent, modelSupportsImageInput, modelSupportsPdfInput } from '../ai/agentUserContent'
import { rewritePdfPayload, type NativePdf } from '../ai/nativePdfPayload'
import { applyProfileToRequestBody, getModelProfile } from '../ai/modelProfiles'

const text = z.string().max(128 * 1024)
const intentSchema = z.object({
  storyboardTarget: z.object({
    projectId: z.string().min(1).max(256), sourceDocumentId: z.string().min(1).max(256),
    sourceDocumentRevision: z.number().int().nonnegative(), sourceDocumentContentHash: z.string().min(1).max(256),
    targetKind: z.literal('storyboard'),
    plans: z.array(z.object({ id: z.string().min(1).max(240), title: z.string().max(500) }).strict()).max(256),
    designId: z.string().min(1).max(240).optional(),
    shotIds: z.array(z.string().min(1).max(240)).min(1).max(128).optional(),
    requestId: z.string().min(1).max(256),
    openResult: z.literal(true).optional(),
  }).strict().optional(),
  documentId: z.string().max(256).optional(),
  // `admissionSurface` is deliberately absent: it decides whether a destructive verb may run
  // (laneHost before_tool), so it is main-derived from this admission's own target — never
  // submitted. Same discipline as `skillPrompt`/`skillSnapshot`: type-only, not in this schema.
  // These are untrusted selectors. The verified Surface factories validate their domain schema.
  target: z.record(z.unknown()).optional(),
  preconditions: z.record(z.unknown()).optional(),
  contextSnapshot: z.object({ version: z.literal(AGENT_CONTEXT_SNAPSHOT_VERSION), handles: z.array(z.record(z.unknown())).max(256) }).strict().optional(),
  systemPrompt: text.optional(),
}).strict()
const composerSchema = intentSchema.extend({
  model: z.object({ vendorKey: z.string().min(1).max(256), modelKey: z.string().min(1).max(256) }).strict().optional(),
  approvalPolicy: z.object({ mode: z.enum(PROJECT_AGENT_APPROVAL_MODES), spend: z.enum(PROJECT_AGENT_SPEND_POLICIES) }).strict(),
  availableModels: z.array(agentModelEntrySchema).max(2048).optional(),
  attachments: z.array(z.object({ assetId: z.string().min(1).max(256), version: z.number().int().positive() }).strict()).max(64).optional(),
  displayText: text.optional(),
  skillKey: z.string().max(256).optional(),
  expectedSkillHash: z.string().min(1).max(256).optional(),
  continueFromEntryId: z.string().min(1).max(256).optional(),
  retryFromEntryId: z.string().min(1).max(256).optional(),
  restoredIntent: intentSchema.optional(),
}).strict().refine(value => !value.restoredIntent || !(value.retryFromEntryId || value.continueFromEntryId))

export function parseLaneComposerContext(value: unknown): LaneComposerContext {
  if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > 256 * 1024) throw new Error('agent_lane_invalid_command')
  return composerSchema.parse(value) as unknown as LaneComposerContext
}

/** Resolve bytes only for provider requests; persisted messages keep immutable asset claims. */
export function createDesktopLaneInput(input: {
  projectId: string
  capture(): LaneComposerContext
  activate(context: LaneComposerContext): void
  prepare(context: LaneComposerContext): Promise<LaneComposerContext>
  model(): { model: Model; kind: string } | undefined
}): NonNullable<OpenLaneOptions['input']> {
  const pdfs = new Map<string, NativePdf>()
  return {
    capture: input.capture,
    prepare: (context) => {
      if (context.storyboardTarget && (context.storyboardTarget.projectId !== input.projectId
        || context.storyboardTarget.sourceDocumentId !== context.documentId
        || context.storyboardTarget.sourceDocumentRevision !== context.preconditions?.document?.revision
        || context.storyboardTarget.sourceDocumentContentHash !== context.preconditions?.document?.contentHash
        || (context.storyboardTarget.shotIds !== undefined && context.storyboardTarget.designId === undefined))) {
        throw new Error('agent_lane_invalid_command')
      }
      resolveProjectAgentAttachmentClaims(input.projectId, context.attachments ?? [])
      return input.prepare(context)
    },
    activate: (context) => { pdfs.clear(); input.activate(context) },
    providerContent: async (message, previous) => {
      const selected = input.model()
      if (!selected) throw new Error('Model is not configured')
      const refs = resolveProjectAgentAttachmentClaims(input.projectId, message.context.attachments ?? [])
      const attachments = refs.flatMap((ref) => ref.display ? [{
        url: ref.display.url, contentType: ref.display.contentType,
        fileName: ref.display.fileName, kind: ref.display.kind,
      }] : [])
      const { model } = selected
      const content = await buildAgentUserContent({
        prompt: [message.content, formatAgentContextSnapshot(message.context.contextSnapshot), formatStoryboardRequestTarget(message.context.storyboardTarget), formatLaneModelDelta(message.context, previous)].filter(Boolean).join('\n\n'),
        attachments,
        supportsImageInput: modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta),
        supportsPdfInput: selected.kind !== 'openai-compatible' && modelSupportsPdfInput(model.modelKey, model.modelAlias, model.meta),
        resolveBytes: (url) => readNomiLocalAsset(url)?.bytes ?? null,
        extractText: (attachment) => extractTextFromLocalAsset(attachment.url, attachment.contentType, attachment.fileName),
      })
      if (typeof content === 'string') return content
      return content.map((part) => {
        if (part.type === 'text') return part
        if (part.type === 'image') return { type: 'image' as const,
          data: Buffer.from(part.image).toString('base64'), mimeType: part.mimeType ?? 'image/png' }
        const data = Buffer.from(part.data).toString('base64')
        const marker = `[nomi-pdf:${createHash('sha256').update(part.data).digest('hex')}]`
        pdfs.set(marker, { marker, fileName: part.fileName, data })
        return { type: 'text' as const, text: marker }
      })
    },
    rewritePayload: (payload, api) => {
      const selected = input.model()
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid provider payload')
      const profiled = selected && api !== 'anthropic-messages'
        ? applyProfileToRequestBody(payload as Record<string, unknown>, getModelProfile(selected.model.modelAlias || selected.model.modelKey)) : payload
      const rewritten = rewritePdfPayload(profiled, api, [...pdfs.values()])
      if ([...pdfs.keys()].some((marker) => !rewritten.applied.has(marker))) {
        throw new Error('Native PDF was not preserved by the provider payload adapter')
      }
      return rewritten.payload
    },
  }
}
