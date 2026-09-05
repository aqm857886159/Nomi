import type { ProjectAgentItem } from '../../../../electron/shared/projectAgentContracts'
import type { ComposerAttachment } from '../composer/composerAttachmentTypes'

export function itemRef(item: ProjectAgentItem): string {
  if (item.kind === 'task') return item.task.kind === 'production-run' ? item.task.runId : item.task.jobId
  if (item.kind === 'artifact') return item.artifact.artifactId
  if (item.kind === 'proposal') return item.approval?.approvalId ?? item.humanApproval?.challengeId ?? ''
  return ''
}

export function attachmentPayloads(attachments: readonly ComposerAttachment[]) {
  return attachments.filter((item) => item.status === 'ready' && item.url).map((item) => ({ url: item.url!, contentType: item.contentType, fileName: item.fileName, kind: item.kind }))
}
