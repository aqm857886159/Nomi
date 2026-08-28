import { describe, expect, it } from 'vitest'

import {
  candidateFromWorkflowMutation,
  candidateFailureText,
  settleCandidateUiRun,
  type ComfyCandidateUiState,
} from './comfyCandidateUiFlow'

describe('ComfyUI component candidate state flow', () => {
  const candidate: ComfyCandidateUiState = {
    vendorKey: 'comfyui-local--candidate-new',
    modelKey: 'workflow-1',
    revisionId: 'comfy-new',
  }

  it('retains the formal import/update DTO and switches to the promoted active identity only on success', () => {
    expect(candidateFromWorkflowMutation({ ok: true, kind: 'video', taskKind: 'text_to_video', ...candidate })).toEqual(candidate)
    expect(settleCandidateUiRun(candidate, {
      ok: true,
      revisionId: 'comfy-new',
      active: { vendorKey: candidate.vendorKey, modelKey: candidate.modelKey },
    })).toEqual({
      applied: true,
      candidate: null,
      active: { vendorKey: candidate.vendorKey, modelKey: candidate.modelKey },
    })
  })

  it('clears the matching failed revision but ignores a stale completion after a newer save', () => {
    expect(settleCandidateUiRun(candidate, {
      ok: false, revisionId: 'comfy-new', reasonCode: 'provider_failed', params: {},
    })).toMatchObject({ applied: true, candidate: null })

    const newer = { ...candidate, revisionId: 'comfy-newer', vendorKey: 'comfyui-local--candidate-newer' }
    expect(settleCandidateUiRun(newer, {
      ok: false, revisionId: 'comfy-new', reasonCode: 'candidate_timeout', params: {},
    })).toEqual({ applied: false, candidate: newer })
  })

  it('renders only the stable reason and allowlisted structured params', () => {
    expect(candidateFailureText({
      ok: false, revisionId: 'comfy-new', reasonCode: 'media_kind_mismatch', params: { expectedKind: 'video' },
    })).toBe('media_kind_mismatch (expectedKind=video)')
  })
})
