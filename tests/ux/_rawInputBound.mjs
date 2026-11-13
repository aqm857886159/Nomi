// 原始输入的统一上限：page.mouse / page.keyboard / page.touchscreen 的方法在 Playwright 里不收 timeout，
// 走查里一下没回来，就一直挂到外层 timeout（900 秒），后面所有站都没有收据，也说不出挂在哪一步。
// 实例：shell-redesign 抽屉拖宽那一下 mouse.move——页面派发了 dragstart、引擎又放弃了这次拖动，
// Playwright 等一个永远不来的 Input.dragIntercepted（它自己的那一步 await 不受任何超时管）。
//
// 这里在共享启动器给每个窗口的原始输入套上站点预算（_station-budget.mjs 的两个本地动作 = 30 秒）：
// 超时就以调用处的堆栈抛错，走查红在那一行；原来那个挂着的调用随窗口关闭一起结束。
// 只管「本来就该瞬间完成」的原始输入；locator 动作 / expect 自带 timeout，evaluate 可能合法地长等，不在这里管。
import { stationTimeout } from './_station-budget.mjs'

export const RAW_INPUT_LIMIT_MS = stationTimeout({ operations: 2 })

/** 每个设备上要套上限的方法（Playwright 公开 API 里全部不收 timeout 的原始输入）。 */
export const RAW_INPUT_METHODS = Object.freeze({
  mouse: Object.freeze(['move', 'down', 'up', 'click', 'dblclick', 'wheel']),
  keyboard: Object.freeze(['down', 'up', 'press', 'type', 'insertText']),
  touchscreen: Object.freeze(['tap']),
})

export class RawInputStallError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RawInputStallError'
    this.code = 'NOMI_RAW_INPUT_STALL'
  }
}

const BOUND = Symbol.for('nomi.rawInputBound')

/** 调用方自己写的 delay 是正常耗时，不算挂住：按 Playwright 的语义折成额外时间。 */
function delayAllowance(device, method, args) {
  const options = args.find((arg) => arg && typeof arg === 'object') ?? {}
  const delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : 0
  if (!delay) return 0
  if (device === 'keyboard' && method === 'type') return delay * String(args[0] ?? '').length
  if (device === 'mouse' && (method === 'click' || method === 'dblclick')) return delay * 2 * (method === 'dblclick' ? 2 : (options.clickCount ?? 1))
  return delay
}

function callSiteStack(site) {
  return String(site.stack ?? '').split('\n').slice(1).filter((line) => !line.includes('_rawInputBound.mjs')).join('\n')
}

/**
 * 给一个 Playwright Page 的原始输入套上限。重复调用无副作用。
 * @param {import('playwright').Page} page
 * @param {{ limitMs?: number, label?: string }} [options]
 */
export function boundRawInput(page, { limitMs = RAW_INPUT_LIMIT_MS, label = 'walk window' } = {}) {
  if (!page || page[BOUND]) return page
  Object.defineProperty(page, BOUND, { value: true })
  for (const [device, methods] of Object.entries(RAW_INPUT_METHODS)) {
    const target = page[device]
    if (!target) continue
    for (const method of methods) {
      const original = target[method]
      if (typeof original !== 'function') continue
      target[method] = function boundedRawInput(...args) {
        const site = new Error('raw input call site')
        const budget = limitMs + delayAllowance(device, method, args)
        let timer
        const stalled = new Promise((_, reject) => {
          timer = setTimeout(() => {
            const shown = args.map((arg) => (typeof arg === 'string' ? JSON.stringify(arg) : typeof arg === 'number' ? String(Math.round(arg)) : arg && typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(', ')
            const error = new RawInputStallError(`${label}: ${device}.${method}(${shown}) 超过 ${budget}ms 没有返回——原始输入不带超时，这一步挂住了（常见：页面派发了 dragstart 又没真开始拖、窗口不再出帧）`)
            error.stack = `${error.name}: ${error.message}\n${callSiteStack(site)}`
            reject(error)
          }, budget)
        })
        return Promise.race([original.apply(this, args), stalled]).finally(() => clearTimeout(timer))
      }
    }
  }
  return page
}
