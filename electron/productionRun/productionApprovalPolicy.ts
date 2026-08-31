/**
 * User-visible approval policy. Durable ProductionRun gates remain finer grained;
 * this mapping only decides which gates are merged, automatic, or conditionally shown.
 */
export type VisibleApproval =
  | 'creative_lock'
  | 'production_lock'
  | 'automatic'
  | 'conditional_sample_or_exception'
  | 'final_cut'

export type ApprovalTrustLevel = 'key_confirm' | 'budget_only' | 'confirm_all'

export function visibleApprovalFor(stage: string): VisibleApproval {
  if (stage === 'direction' || stage === 'script' || stage === 'storyboard') return 'creative_lock'
  if (stage === 'contract') return 'production_lock'
  if (stage === 'freeze' || stage === 'qa') return 'automatic'
  if (stage === 'shot') return 'conditional_sample_or_exception'
  if (stage === 'export' || stage === 'rough-cut') return 'final_cut'
  return 'automatic'
}

export function shouldShowShotApproval(trustLevel: ApprovalTrustLevel, qualityException: boolean): boolean {
  return trustLevel === 'confirm_all' || qualityException
}

export function shouldMergeCreativeReview(hasFreshStoryboard: boolean): boolean {
  return hasFreshStoryboard
}
