import type {
  ProjectAgentAttachmentClaim,
  ProjectAgentAttachmentRef,
} from '../../../electron/shared/projectAgentContracts'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'

export function projectAgentAttachmentClaims(
  attachments: readonly ComposerAttachment[],
): readonly ProjectAgentAttachmentClaim[] {
  return Object.freeze(
    attachments.map((attachment) => {
      if (
        attachment.status !== 'ready' ||
        !attachment.assetId ||
        !attachment.contentHash ||
        !attachment.url
      ) {
        throw new Error('project_agent_attachment_not_ready')
      }
      return Object.freeze({
        assetId: attachment.assetId,
        version: 1,
      })
    }),
  )
}

export function composerAttachmentsFromProjectAgentRefs(
  refs: readonly ProjectAgentAttachmentRef[],
): ComposerAttachment[] {
  return refs.flatMap((ref) =>
    ref.display
      ? [{
          id: ref.assetId,
          assetId: ref.assetId,
          contentHash: ref.contentHash,
          fileName: ref.display.fileName,
          contentType: ref.display.contentType,
          sizeBytes: ref.display.sizeBytes,
          kind: ref.display.kind,
          status: 'ready' as const,
          url: ref.display.url,
        }]
      : [],
  )
}
