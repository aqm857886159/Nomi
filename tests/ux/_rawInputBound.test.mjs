// 钉住「走查原始输入挂住要在站点预算内红在调用处」：Playwright 的 mouse / keyboard / touchscreen 不收 timeout，
// 一下没回来就是外层 900 秒、后面全站没收据（shell-redesign 抽屉拖宽那次）。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RAW_INPUT_LIMIT_MS, RAW_INPUT_METHODS, RawInputStallError, boundRawInput } from './_rawInputBound.mjs'
import { stationTimeout } from './_station-budget.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const never = () => new Promise(() => {})

function fakePage(impl = () => Promise.resolve('done')) {
  const page = {}
  for (const [device, methods] of Object.entries(RAW_INPUT_METHODS)) {
    page[device] = {}
    for (const method of methods) page[device][method] = vi.fn(impl)
  }
  return page
}

afterEach(() => { vi.useRealTimers() })

describe('boundRawInput', () => {
  test('上限就是站点预算的两个本地动作（30 秒），不另立一个数', () => {
    expect(RAW_INPUT_LIMIT_MS).toBe(stationTimeout({ operations: 2 }))
    expect(RAW_INPUT_LIMIT_MS).toBe(30_000)
  })

  test('挂住的 mouse.move 到上限就抛 RawInputStallError，堆栈指回走查里调用的那一行', async () => {
    vi.useFakeTimers()
    const page = boundRawInput(fakePage(never), { label: 'shell-redesign' })
    const pending = page.mouse.move(120, 300, { steps: 6 }) // ← 调用处
    const settled = pending.then(() => 'resolved', (error) => error)
    await vi.advanceTimersByTimeAsync(RAW_INPUT_LIMIT_MS - 1)
    let early = 'pending'
    settled.then((value) => { early = value })
    await Promise.resolve()
    expect(early).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    const error = await settled
    expect(error).toBeInstanceOf(RawInputStallError)
    expect(error.message).toContain('shell-redesign: mouse.move(120, 300, {"steps":6})')
    expect(error.stack).toContain('_rawInputBound.test.mjs')
    expect(error.stack).not.toContain('_rawInputBound.mjs:')
  })

  test('正常返回的调用原样透传结果，过了上限也不再抛', async () => {
    vi.useFakeTimers()
    const page = boundRawInput(fakePage(() => Promise.resolve('ok')))
    await expect(page.keyboard.press('Escape')).resolves.toBe('ok')
    await vi.advanceTimersByTimeAsync(RAW_INPUT_LIMIT_MS * 2)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('原调用自己报的错原样透传', async () => {
    const boom = new Error('Target page, context or browser has been closed')
    const page = boundRawInput(fakePage(() => Promise.reject(boom)))
    await expect(page.mouse.down()).rejects.toBe(boom)
  })

  test('调用方写的 delay 是正常耗时：keyboard.type 按字数折算，不误判成挂住', async () => {
    vi.useFakeTimers()
    const page = boundRawInput(fakePage(never))
    const settled = page.keyboard.type('abc', { delay: 10_000 }).then(() => 'resolved', (error) => error)
    let state = 'pending'
    settled.then((value) => { state = value })
    await vi.advanceTimersByTimeAsync(RAW_INPUT_LIMIT_MS + 29_999)
    expect(state).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toBeInstanceOf(RawInputStallError)
  })

  test('重复装不会套两层', () => {
    const page = fakePage()
    boundRawInput(page)
    const once = page.mouse.move
    boundRawInput(page)
    expect(page.mouse.move).toBe(once)
  })

  test('类：Playwright 公开的 Mouse / Keyboard / Touchscreen 每个方法都在上限名单里（升级加了新方法会红）', () => {
    const require = createRequire(import.meta.url)
    const core = path.dirname(require.resolve('playwright-core/package.json', { paths: [path.dirname(require.resolve('playwright'))] }))
    const source = fs.readFileSync(path.join(core, 'types/types.d.ts'), 'utf8')
    const file = ts.createSourceFile('types.d.ts', source, ts.ScriptTarget.Latest, true)
    const declared = {}
    for (const statement of file.statements) {
      if (!ts.isInterfaceDeclaration(statement)) continue
      const device = { Mouse: 'mouse', Keyboard: 'keyboard', Touchscreen: 'touchscreen' }[statement.name.text]
      if (!device) continue
      declared[device] = [...new Set(statement.members.filter((member) => ts.isMethodSignature(member)).map((member) => member.name.text))].sort()
    }
    expect(Object.keys(declared).sort()).toEqual(Object.keys(RAW_INPUT_METHODS).sort())
    for (const [device, methods] of Object.entries(declared)) expect([...RAW_INPUT_METHODS[device]].sort(), device).toEqual(methods)
  })

  test('类：共享启动器的首个窗口和后来弹出的窗口都经同一个 instrumentWalkWindow 装上限', () => {
    const source = fs.readFileSync(path.join(here, '_launchApp.mjs'), 'utf8')
    const body = source.slice(source.indexOf('export function instrumentWalkWindow'), source.indexOf('export async function launchNomiApp'))
    expect(body).toContain('boundRawInput(page')
    expect(body).toContain('installFeelObserver(page')
    // 窗口仪表只许经这个函数装：启动器其它地方不许再单独装体感观察器（那样会有窗口只装一半）。
    const outside = source.replace(body, '')
    expect(outside).not.toMatch(/installFeelObserver\(/)
    expect(outside).toContain('instrumentWalkWindow(win, name)')
    expect(outside).toMatch(/app\.on\('window', \(page\) => instrumentWalkWindow\(page,/)
  })
})
