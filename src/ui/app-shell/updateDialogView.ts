import type { UpdaterErrorStage, UpdaterPhase } from '../../../electron/shared/updateReminder'
import type { UpdateDialogView } from './UpdateDialog'

/** 手动检查失败（stage=check）不开弹窗，错误只在设置→关于里说；其余有更新的状态才可能开。 */
export function isDialogPhase(phase: UpdaterPhase, errorStage: UpdaterErrorStage | null): boolean {
  return phase === 'available' || phase === 'downloading' || phase === 'downloaded' || (phase === 'error' && errorStage !== 'check')
}

/**
 * 弹窗现在该显示哪一屏；null = 不显示。后台事件从不主动开窗：只有用户请求过（dialogOpen）才可能显示，
 * 检查开始 / 检查结束（已是最新）这类状态一律不显示（把过期弹窗收掉）。
 */
export function deriveDialogView(input: {
  dialogOpen: boolean
  phase: UpdaterPhase
  errorStage: UpdaterErrorStage | null
  canAutoInstall: boolean
  macStepsShown: boolean
}): UpdateDialogView | null {
  if (!input.dialogOpen || !isDialogPhase(input.phase, input.errorStage)) return null
  if (input.phase === 'error') return 'failed'
  if (input.phase === 'downloading') return 'downloading'
  if (input.phase === 'downloaded') return 'ready'
  return !input.canAutoInstall && input.macStepsShown ? 'mac-steps' : 'available'
}
