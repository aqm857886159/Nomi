// 系统提示词编辑器的真人路径（2026-09-14 从设置 → AI 策略搬到 Agent 面板的权限弹层）：
//   点 composer 底栏的档位钮（每步问 / 自动改 / 全自动）→ 弹层底部「编辑系统提示词」→ 弹窗里就是编辑器。
// 走查一律走这条路，不派事件、不灌状态（tests-must-drive-ui-like-a-human）。
import { clickOrFail, expectVisible } from './_assert.mjs'

export const SYSTEM_PROMPT_EDITOR = '[data-system-prompt-editor]'

export async function openSystemPromptEditor(win, { timeout = 10_000 } = {}) {
  const permission = win.locator('[data-v4-control="permission"]:visible').first()
  await clickOrFail(permission, 'composer 档位钮', { timeout })
  await clickOrFail(win.locator('[data-v4-control="system-prompt"]').first(), '编辑系统提示词', { timeout })
  const editor = win.locator(SYSTEM_PROMPT_EDITOR).first()
  await expectVisible(editor, '点了「编辑系统提示词」但编辑器弹窗没出现', timeout)
  return editor
}
