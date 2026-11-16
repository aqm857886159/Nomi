// 「生成中的这一镜，节点 ↑ 再按一下会怎样」的量法。
// 现行规矩（用户 2026-11-02 拍板、3797fde0c 落地）：人亲手点不再被一个置灰的钮拒绝，改成问一句
// 「再发一次？上一次还没结束，可能再扣一次钱」，确认才发；同一次点击只发一次。
// 这两条走查以前量的是「钮置灰」——那是 11-02 之前的做法，11-07 夜跑起每晚红在这一句。
// 现在量的是真正的保证：按了之后屏上问了「再发一次」，没确认就一笔都不多发，取消后什么都没变。
import { expect, proveProbe } from './_assert.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const DICT_LOCALE = { zh: 'zh-CN', 'zh-CN': 'zh-CN', en: 'en' }

/**
 * 按一下生成中节点的 ↑：问「再发一次」，取消，供应商收到的笔数不变。
 * `countRequests`：返回这一镜供应商此刻收到几笔。`locale`：zh / zh-CN / en（界面此刻的语言）。
 */
export async function expectGeneratingUpAsksBeforeResend(win, button, { label, countRequests, locale, kind = 'image', renderedBusy = true }) {
  await proveProbe(button, `${label}：生成钮在屏上`)
  // renderedBusy:false = 窗口重载过，渲染层不记得它在生成（钮不转圈），在途只有主进程的账记着。
  if (renderedBusy) expect(await button.getAttribute('aria-busy'), `${label}：钮标着生成中（aria-busy）`).toBe('true')
  const before = countRequests()
  await button.click({ noWaitAfter: true })
  const dialog = win.locator(SPEND_DIALOG).first()
  await dialog.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  const L = DICT_LOCALE[locale]
  await expect(dialog, `${label}：问的是「再发一次」`).toContainText(uiText(L, `generationCommon.spend.resend.title.${kind}`))
  await expect(dialog, `${label}：说可能再扣一次钱`).toContainText(uiText(L, 'generationCommon.spend.resend.waiting').split('\n')[1])
  expect(countRequests(), `${label}：没确认之前供应商一笔都没多收`).toBe(before)
  await dialog.locator('[data-spend-confirm-action="cancel"]').click({ noWaitAfter: true })
  await dialog.waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 2 }) })
  expect(countRequests(), `${label}：取消之后供应商仍是原来的笔数`).toBe(before)
}
