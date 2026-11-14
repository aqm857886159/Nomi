import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Nomi 形态「人选的 / 此刻显示的 / 算出来的」分开放（方向检查 docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md，
// 设计卡 docs/plan/2026-11-14-agent-form-restructure.md ★2）。这里钉结构，让旧的那类错写不出来：
//   · 此刻那份（agentFormViewStore）挂不上 persist、别的文件碰不到它；
//   · 除了两个 store 自己，没有文件读持久化的摆法 / 收没收起、也没有文件直接 setState 改形态——此刻显示什么只问 shownForm；
//   · 人的动作只在外壳里调；机器的让位只在两处机器流程里调（协调 2026-11-14：人动作记下、机器让位不记）；
//   · 改存法前的那几个公开写入口和三种读法，整个 src 里不再出现。
const SRC = fileURLToPath(new URL('../../../', import.meta.url))
const STORE = 'src/ui/app-shell/shell/agentFormStore.ts'
const VIEW_STORE = 'src/ui/app-shell/shell/agentFormViewStore.ts'
const THIS_FILE = 'src/ui/app-shell/shell/agentFormShownVsStored.structure.test.ts'

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

const relative = (file: string): string => path.relative(path.join(SRC, '..'), file).split(path.sep).join('/')
const isTest = (file: string): boolean => /\.test\.(ts|tsx)$/.test(file) || /agentFormProbe\.(testkit|globals)\.tsx?$/.test(file)

const all = sourceFiles(SRC).map((file) => {
  const raw = readFileSync(file, 'utf8')
  return { file: relative(file), raw, text: stripComments(raw) }
})
const production = all.filter(({ file }) => !isTest(file))
const owners = new Set([STORE, VIEW_STORE])
const textOf = (file: string): string => all.find((entry) => entry.file === file)!.text

describe('Nomi 形态：人选的 / 此刻显示的 / 算出来的分开放', () => {
  it('此刻那份不挂 persist（窄窗里的点开 / 收起、机器让位写不进磁盘）', () => {
    const view = textOf(VIEW_STORE)
    expect(view).not.toMatch(/\bpersist\s*\(/)
    expect(view).not.toContain('zustand/middleware')
    expect(view).not.toMatch(/localStorage|sessionStorage/)
  })

  it('只有 agentFormStore 碰此刻那份（别的文件拿不到覆盖，只能问 shownForm）', () => {
    const importers = all.filter(({ file, text }) => file !== VIEW_STORE && /from\s+['"][^'"]*agentFormViewStore['"]/.test(text) && !isTest(file)).map(({ file }) => file)
    expect(importers).toEqual([STORE])
  })

  it('两个 store 之外，没有生产代码读持久化的摆法 / 收没收起、旧的 form，也没有直接 setState 改形态', () => {
    const hits = production.filter(({ file }) => !owners.has(file)).flatMap(({ file, text }) => [
      ...[...text.matchAll(/bySurface[^\n;]*?\.(form|placement|collapsed)\b/g)].map((match) => `${file}: ${match[0]}`),
      ...[...text.matchAll(/useAgentFormStore\.setState\b/g)].map(() => `${file}: useAgentFormStore.setState`),
    ])
    expect(hits, '此刻显示什么只问 shownForm / useShownForm；要改就调动作').toEqual([])
  })

  it('人的动作只在外壳里调；机器让位只在挑参考图、指向节点这两处机器流程里调', () => {
    const callers = (pattern: RegExp): string[] => production.filter(({ file, text }) => !owners.has(file) && pattern.test(text)).map(({ file }) => file).sort()
    expect(callers(/\b(openAgent|collapseAgent|chooseAgentPlacement)\s*\(/)).toEqual(['src/ui/app-shell/shell/ShellAgentHost.tsx'])
    expect(callers(/\b(machineHold|machineRelease)\s*\(/)).toEqual(['src/workbench/ai/ProjectAgentResidentShell.tsx', 'src/workbench/ai/pointer/revealNodeFromChat.ts'])
    // 挑参考图是机器把对话摆出来（只写此刻那份），不是替人点开。
    expect(textOf('src/workbench/ai/ProjectAgentResidentShell.tsx')).toMatch(/machineHold\(\s*'generation',\s*'open'\s*\)/)
    const reveal = textOf('src/workbench/ai/pointer/revealNodeFromChat.ts')
    expect(reveal).toMatch(/machineHold\(\s*surface,\s*'ball'\s*\)/)
    expect(reveal).toMatch(/machineRelease\(/)
  })

  it('改存法前的公开写入口和三种读法，整个 src 里 0 处（连注释也算，和 git grep 同口径）', () => {
    // 名字用字符类拼，免得这份名单自己算一处命中。
    const retired = [/\bopen[F]ormFor\b/, /\bset[F]orm\b/, /\brequest[F]orm\b/, /\bchoose[F]orm\b/, /\bdock[S]uppressed\b/, /\bsetDock[S]uppressed\b/,
      /\bnarrow[S]hown\b/, /\buseEffective[A]gentForm\b/, /\breadEffective[A]gentForm\b/, /\beffective[A]gentForm\b/, /\bshownIgnoring[S]uppression\b/]
    const hits = all.filter(({ file }) => file !== THIS_FILE).flatMap(({ file, raw }) => retired.filter((pattern) => pattern.test(raw)).map((pattern) => `${file}: ${pattern.source}`))
    expect(hits).toEqual([])
  })
})
