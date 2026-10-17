// 「读目录的 IPC 不许写盘」这条不变量的机器化持有者（2026-09-21 反转，见文末「为什么反过来了」）。
//
// 判据是对**注册点集合**的断言，不是对某一条频道的行为断言：要证的是「**每一条**读频道都是纯读」，
// 而漏掉的那一条恰恰是没人想起来去写测试的那一条。所以用源码静态扫描。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')

/**
 * 注册行：`registerSyncIpc("<channel>", <handler>);` 或 `ipcMain.handle("<channel>", (event, …) => { …; return <handler>(…); });`
 * （2026-10-16 起目录读频道走异步 invoke）——handler 一直吃到行尾的 `);`（行尾注释不算）。
 *
 * 别写成 `[^)]*?`：包了一层的 handler 自己就带一对括号，那种写法会把**已经包好的**那些行
 * 全部漏掉，只剩没包的能匹配上——扫描器于是安静地只看得见一小半注册点（第一版就是这样，
 * 靠下面那条阳性对照才露馅）。
 */
const REGISTRATION = /(?:registerSyncIpc|ipcMain\.handle)\("(nomi:model-catalog:[^"]+)",\s*(.*?)\);(?:\s*\/\/.*)?\s*$/gm

/**
 * 读频道的判据写成**白名单式的动词表**而不是「不是写就是读」：
 * 新增一个动词（比如将来的 `:diff`）会落在两边之外，这条测试会逼作者显式回答它是读还是写。
 */
const READ_SUFFIXES = [':list', ':health', ':export']
const WRITE_SUFFIXES = [':upsert', ':delete', ':clear', ':retype', ':import']

/** 写盘的函数名。读频道的 handler 里出现任何一个，就是读路径挂了写。 */
const WRITE_ON_READ = ['ensureBuiltinModelSeeds', 'writeCatalog', 'writeConfigFileAtomic', 'writeJsonFileAtomic']

function classify(channel: string): 'read' | 'write' | 'unknown' {
  if (READ_SUFFIXES.some((suffix) => channel.endsWith(suffix))) return 'read'
  if (WRITE_SUFFIXES.some((suffix) => channel.endsWith(suffix))) return 'write'
  return 'unknown'
}

function registrations(): { channel: string; handler: string; kind: ReturnType<typeof classify> }[] {
  REGISTRATION.lastIndex = 0
  const rows: { channel: string; handler: string; kind: ReturnType<typeof classify> }[] = []
  for (const match of mainSource.matchAll(REGISTRATION)) {
    rows.push({ channel: match[1], handler: match[2].trim(), kind: classify(match[1]) })
  }
  return rows
}

describe('model catalog read channels do not write', () => {
  // 阳性对照：扫不到注册行时下面每一条断言都会「空集通过」，而空集通过和真通过在屏幕上一模一样。
  it('actually finds the model-catalog registrations it claims to check', () => {
    const rows = registrations()
    expect(rows.length, '在 electron/main.ts 里一条 nomi:model-catalog:* 注册都没扫到——正则失效了，不是代码干净了').toBeGreaterThan(10)
    expect(rows.filter((row) => row.kind === 'read').length).toBeGreaterThan(1)
  })

  it('keeps every catalog read channel a pure read', () => {
    const writing = registrations()
      .filter((row) => row.kind === 'read' && WRITE_ON_READ.some((fn) => row.handler.includes(fn)))
      .map((row) => `${row.channel} → ${row.handler}`)
    expect(
      writing,
      '读目录的频道挂了写盘：盘上版本高于本应用时这次写会被只读保护拒绝并抛出，'
        + '一路翻成渲染层的空白设置页（rootcause-config-loss-on-reinstall.md §0）。种子对账只在启动期跑。',
    ).toEqual([])
  })

  it('reconciles the builtin seeds exactly once at startup, on the app-main boot path', () => {
    // 摘掉读路径那次之后，种子对账只剩启动期这一处；它若也没了，新内置模型就永远不落盘。
    const bootCalls = mainSource.match(/ensureBuiltinModelSeeds\(\)/g) ?? []
    expect(bootCalls.length, 'electron/main.ts 里种子对账应当只有启动期那一次调用').toBe(1)
    // 位置也要钉：必须在最后一处 `.whenReady()` 之后、`await createWindow()` 之前——
    // 渲染层一进库就同步读目录，种子晚一步落盘，第一屏就是旧目录。
    const seedAt = mainSource.indexOf('ensureBuiltinModelSeeds()')
    const readyAt = mainSource.lastIndexOf('.whenReady()')
    const windowAt = mainSource.indexOf('await createWindow()')
    expect(readyAt, 'electron/main.ts 里找不到 .whenReady() 启动序列').toBeGreaterThan(-1)
    expect(windowAt, 'electron/main.ts 里找不到 await createWindow()').toBeGreaterThan(-1)
    expect(seedAt > readyAt && seedAt < windowAt, '种子对账必须在 whenReady 之后、createWindow 之前').toBe(true)
  })

  it('forces a read/write decision for any newly added catalog verb', () => {
    const unknown = registrations().filter((row) => row.kind === 'unknown').map((row) => row.channel)
    expect(unknown, '新增了一个既不在读动词表也不在写动词表里的目录频道：请在本文件的 READ_SUFFIXES / WRITE_SUFFIXES 里显式归类').toEqual([])
  })
})

// 为什么这条不变量在 2026-09-21 被反了过来：
//
// 它原先要求的是相反的事——每条读频道都**必须**先跑一次 `ensureBuiltinModelSeeds()`，理由是
// 一个真实缺陷：`models:list` 补了种子、紧邻的 `vendors:list` 没补，新增的内置供应商在模型列表里有、
// 在供应商列表里没有，直到主进程冷重启。
//
// 那条理由只在**开发时热更新渲染层**才成立（用户那边每次启动都会跑启动期那一次），而它的代价落在
// 用户身上：盘上目录版本高于本应用（装过新版又装回旧版）时，读顺带的那次写被「不许静默降级」保护
// 拒绝 → 抛错 → `registerSyncIpc` 翻成 `{ok:false}` → preload 重新抛 → 设置页裸 catch 置空。
// 用户看到一个空白的、零报错的模型设置页，也就是那句「所有模型配置都没了」。
//
// 同一条集合式判据留着，只是方向换了：开发者的便利换用户的配置，这笔账不能这么算。
