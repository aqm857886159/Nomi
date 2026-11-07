import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// WindowNarrow 板约束 narrow.one-threshold（用户 2026-11-07 拍板）：外壳只有一处「窗口宽 < 1060」的判断
// （agentFormStore 的 NARROW_TIER_QUERY，由 ShellAgentHost 一条 matchMedia 订阅）；各界面别的地方只按
// 「内容放不下才收」（容器查询 / ResizeObserver），不再各写一套窗口宽断点。
// 这里钉写法：新增窗口宽断点（matchMedia 宽度查询、拿 window.innerWidth 跟数字比、Tailwind 视口任意值变体）就红。
// 下面的名单是 2026-11-08 已有的那几处（各有各的历史，不在这次改动里动），只许减不许加。
const SRC = fileURLToPath(new URL('../../../', import.meta.url))

const EXISTING_VIEWPORT_BREAKPOINTS = new Set([
  'src/ui/app-shell/UpdatePill.tsx max-[899px]:',
  'src/ui/browser/popover/BrowserAssetPopoverView.tsx max-[760px]:',
  'src/workbench/library/ProjectLibraryPage.tsx min-[1200px]:',
  'src/workbench/onboarding/HandbookPanel.tsx max-[560px]:',
  'src/workbench/preview/EditingLayoutMenu.tsx max-[1440px]:',
  'src/workbench/generationCanvas/components/generationCanvasGeometry.ts window.innerWidth < 700',
])

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'devlab' ? [] : sourceFiles(full)
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [full]
  })
}

function relative(file: string): string {
  return path.relative(path.join(SRC, '..'), file).split(path.sep).join('/')
}

describe('窄窗只有一个阈值（narrow.one-threshold）', () => {
  const files = sourceFiles(SRC).map((file) => ({ file: relative(file), text: stripComments(readFileSync(file, 'utf8')) }))

  it('按窗口宽查的 matchMedia 只有外壳那一条', () => {
    const hits = files.flatMap(({ file, text }) => (/matchMedia\(\s*(?!['"`]\(prefers-)/.test(text) ? [file] : []))
    expect(hits.sort()).toEqual(['src/ui/app-shell/shell/ShellAgentHost.tsx', 'src/ui/app-shell/shell/agentFormStore.ts'])
    const store = files.find(({ file }) => file === 'src/ui/app-shell/shell/agentFormStore.ts')!.text
    expect(store).toContain('export const NARROW_TIER_WIDTH = ASSISTANT_CONTENT_FLOOR + ASSISTANT_WIDTH_MIN')
    const host = files.find(({ file }) => file === 'src/ui/app-shell/shell/ShellAgentHost.tsx')!.text
    expect(host).toContain('window.matchMedia(NARROW_TIER_QUERY)')
  })

  it('1060 不在任何地方写死（阈值由内容底线 + 停靠栏下限推出来）', () => {
    const hits = files.flatMap(({ file, text }) => (/(?<![\d.])1060(?![\d])/.test(text) ? [file] : []))
    expect(hits).toEqual([])
  })

  it('不新增窗口宽断点：拿 window.innerWidth 跟数字比、Tailwind 视口任意值变体，只许名单里已有的', () => {
    const found = files.flatMap(({ file, text }) => [
      ...[...text.matchAll(/window\.innerWidth\s*[<>]=?\s*\d+/g)].map((match) => `${file} ${match[0]}`),
      ...[...text.matchAll(/\b(?:min|max)-\[\d+px\]:/g)].map((match) => `${file} ${match[0]}`),
    ])
    const fresh = [...new Set(found)].filter((entry) => !EXISTING_VIEWPORT_BREAKPOINTS.has(entry))
    expect(fresh, '新的窗口宽断点：窄窗只认外壳那一个阈值，其余按「放不下才收」写（容器查询 / ResizeObserver）').toEqual([])
  })
})
