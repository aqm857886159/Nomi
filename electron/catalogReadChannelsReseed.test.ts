// 「读目录的 IPC 必须先补一次内置种子」这条不变量的机器化持有者（2026-09-11）。
//
// 它存在的理由是一个真实缺陷：`nomi:model-catalog:models:list` 读之前补种子（注释写得明明白白），
// 紧邻的 `nomi:model-catalog:vendors:list` 没补，于是新增的内置供应商种子在**模型**列表里有、
// 在**供应商**列表里没有，直到主进程冷重启——用户看到的就是「设置里的供应商列表不全」。
//
// 两条读路径读的是同一份目录，补种子这件事就不能只做一半。而「记得补」如果只靠写代码的人自觉，
// 下一个新增的读频道还会再漏一次（这一次就是第二次：mappings:list 与 health 同样漏了）。
// 所以把判据搬到这里：新增任何一条读目录的频道而忘了走 readCatalog，这条测试当场标出频道名。
//
// 为什么是源码静态扫描而不是行为测试：要证的是「**每一条**读频道都补」，这是对注册点集合的断言；
// 行为测试只能一条一条证，而漏掉的那一条恰恰是没人想起来去写测试的那一条。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')

/**
 * 注册行：`registerSyncIpc("<channel>", <handler>);`——handler 一直吃到行尾的 `);`。
 *
 * 别写成 `[^)]*?`：`readCatalog(listModelCatalogVendors)` 自己就带一对括号，那种写法会把**已经包好的**
 * 那些行全部漏掉，只剩没包的能匹配上——扫描器于是安静地只看得见一小半注册点（第一版就是这样，
 * 靠上面那条阳性对照才露馅）。
 */
const REGISTRATION = /registerSyncIpc\("(nomi:model-catalog:[^"]+)",\s*(.*?)\);\s*$/gm

/**
 * 读频道的判据写成**白名单式的动词表**而不是「不是写就是读」：
 * 新增一个动词（比如将来的 `:diff`）会落在两边之外，这条测试会逼作者显式回答它是读还是写，
 * 而不是默认当成写、悄悄绕过补种子。
 */
const READ_SUFFIXES = [':list', ':health', ':export']
const WRITE_SUFFIXES = [':upsert', ':delete', ':clear', ':retype', ':import']

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

describe('model catalog read channels reseed builtins first', () => {
  // 阳性对照：扫不到注册行时下面每一条断言都会「空集通过」，而空集通过和真通过在屏幕上一模一样。
  it('actually finds the model-catalog registrations it claims to check', () => {
    const rows = registrations()
    expect(rows.length, '在 electron/main.ts 里一条 nomi:model-catalog:* 注册都没扫到——正则失效了，不是代码干净了').toBeGreaterThan(10)
    expect(rows.filter((row) => row.kind === 'read').length).toBeGreaterThan(1)
  })

  it('routes every catalog read through readCatalog()', () => {
    const missing = registrations()
      .filter((row) => row.kind === 'read' && !row.handler.startsWith('readCatalog('))
      .map((row) => `${row.channel} → ${row.handler}`)
    expect(missing, '读目录的频道必须走 readCatalog()（它负责 ensureBuiltinModelSeeds），否则新内置种子要等主进程冷重启才出现').toEqual([])
  })

  // 写路径套上补种子不会更安全，只会让每次写都多跑一次播种；把它也钉住，免得「都包一层」变成默认动作。
  it('leaves catalog writes out of readCatalog()', () => {
    const wrapped = registrations()
      .filter((row) => row.kind === 'write' && row.handler.startsWith('readCatalog('))
      .map((row) => row.channel)
    expect(wrapped, '写频道不该走 readCatalog()——那是读路径的新鲜度保证，不是写路径的前置条件').toEqual([])
  })

  it('forces a read/write decision for any newly added catalog verb', () => {
    const unknown = registrations().filter((row) => row.kind === 'unknown').map((row) => row.channel)
    expect(unknown, '新增了一个既不在读动词表也不在写动词表里的目录频道：请在本文件的 READ_SUFFIXES / WRITE_SUFFIXES 里显式归类').toEqual([])
  })

  it('keeps readCatalog as the single place that reseeds on read', () => {
    const helper = /const readCatalog = [\s\S]{0,200}?ensureBuiltinModelSeeds\(\);/
    expect(helper.test(mainSource), 'readCatalog 必须自己调 ensureBuiltinModelSeeds——这是这条不变量唯一的持有者').toBe(true)
  })
})
