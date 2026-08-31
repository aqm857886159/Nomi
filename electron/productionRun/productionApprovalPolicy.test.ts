import { describe, expect, it } from 'vitest'

import { shouldMergeCreativeReview, shouldShowShotApproval, visibleApprovalFor } from './productionApprovalPolicy'

describe('visible production approval policy', () => {
  it('keeps high-leverage approvals and makes low-leverage stages automatic', () => {
    expect(visibleApprovalFor('direction')).toBe('creative_lock')
    expect(visibleApprovalFor('script')).toBe('creative_lock')
    expect(visibleApprovalFor('storyboard')).toBe('creative_lock')
    expect(visibleApprovalFor('contract')).toBe('production_lock')
    expect(visibleApprovalFor('freeze')).toBe('automatic')
    expect(visibleApprovalFor('qa')).toBe('automatic')
    expect(visibleApprovalFor('shot')).toBe('conditional_sample_or_exception')
    expect(visibleApprovalFor('export')).toBe('final_cut')
  })

  it('only shows per-shot approval for confirm_all or a failed/uncertain quality check', () => {
    expect(shouldShowShotApproval('key_confirm', false)).toBe(false)
    expect(shouldShowShotApproval('budget_only', false)).toBe(false)
    expect(shouldShowShotApproval('key_confirm', true)).toBe(true)
    expect(shouldShowShotApproval('confirm_all', false)).toBe(true)
  })

  it('merges script and storyboard into one visible creative lock when storyboard is fresh', () => {
    expect(shouldMergeCreativeReview(true)).toBe(true)
    expect(shouldMergeCreativeReview(false)).toBe(false)
  })
})
