import { describe, expect, it } from 'vitest'
import {
  composerAttachmentsFromProjectAgentRefs,
  projectAgentAttachmentClaims,
} from './projectAgentAttachments'

describe('ProjectAgent attachment projection', () => {
  it('P2B-ASSET-001 submits only an asset identity and version claim', () => {
    const refs = projectAgentAttachmentClaims([{
      id: 'upload-view-id',
      assetId: 'asset-a',
      contentHash: 'a'.repeat(64),
      fileName: 'reference.png',
      contentType: 'image/png',
      sizeBytes: 42,
      kind: 'image',
      status: 'ready',
      url: 'nomi-local://asset/project-a/assets/imported/reference.png',
    }])

    expect(refs).toEqual([{
      assetId: 'asset-a',
      version: 1,
    }])
  })

  it('restores a composer attachment only from a main-resolved canonical ref', () => {
    expect(composerAttachmentsFromProjectAgentRefs([{
      assetId: 'asset-a',
      contentHash: 'a'.repeat(64),
      version: 1,
      display: {
        url: 'nomi-local://asset/project-a/assets/imported/reference.png',
        fileName: 'reference.png',
        contentType: 'image/png',
        sizeBytes: 42,
        kind: 'image',
      },
    }])).toMatchObject([{
      id: 'asset-a',
      assetId: 'asset-a',
      contentHash: 'a'.repeat(64),
      status: 'ready',
      url: 'nomi-local://asset/project-a/assets/imported/reference.png',
    }])
  })

  it('refuses a display-only ready attachment without stored identity', () => {
    expect(() => projectAgentAttachmentClaims([{
      id: 'view-only',
      fileName: 'reference.png',
      contentType: 'image/png',
      sizeBytes: 42,
      kind: 'image',
      status: 'ready',
      url: 'nomi-local://asset/project-a/assets/imported/reference.png',
    }])).toThrow('project_agent_attachment_not_ready')
  })
})
