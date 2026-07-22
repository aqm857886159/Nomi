/**
 * 素材面「唯一门」不变量守卫（2026-07-22 方案一重执行 · 进五门 test lane）。
 *
 * 为什么存在：07-12 拍板「素材盒只在浏览器语境出现」，守卫当时只放在手动 R13 走查里；
 * 07-19 外部 PR#41 捎带恢复全局素材盒浮窗（宿主A），合并只跑 typecheck/test/build，没拦住。
 * 本测试把不变量搬进合并必经之路：宿主A 的任何一件（文件/入口/事件）被恢复，这里至少一条红。
 *
 * 不变量：
 *  ① 宿主A 文件不存在（GlobalAssetFloatingWindow / useGlobalBrowserAssets / useBrowserAssetCount）
 *  ② 「打开素材盒」入口只允许出现在浏览器工具条域（src/ui/browser/dialog/）
 *  ③ 全局素材盒事件族标识符全仓零引用
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'src')
const SELF = fileURLToPath(import.meta.url)

const BANNED_FILES = [
  'src/ui/browser/window/GlobalAssetFloatingWindow.tsx',
  'src/ui/browser/assets/useGlobalBrowserAssets.ts',
  'src/ui/browser/assets/useBrowserAssetCount.ts',
]

// 拆开拼接，避免本文件自身命中扫描。
const BANNED_IDENTIFIERS = [
  'dispatchGlobal' + 'AssetPopoverOpen',
  'subscribeGlobal' + 'AssetPopoverOpen',
  'getGlobal' + 'AssetPopoverAnchorRect',
  'Global' + 'AssetFloatingWindow',
  'useGlobal' + 'BrowserAssets',
]

// 允许域=整个浏览器域（工具条 dialog/ + 素材盒自身组件 popover/ + overlay/）；
// 不变量的靶子是浏览器域之外的常驻入口（顶栏 app-shell / 工作台 workbench / 库页）。
const ASSET_BOX_ENTRY_MARK = 'aria-label="打开素材' + '盒"'
const ASSET_BOX_ALLOWED_DIR = path.join('src', 'ui', 'browser') + path.sep

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(absolute, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(absolute)
  }
  return out
}

describe('素材面唯一门不变量（方案一 2026-07-22）', () => {
  const repoRoot = path.resolve(SRC_ROOT, '..')
  const sourceFiles = listSourceFiles(SRC_ROOT).filter((file) => file !== SELF)

  it('① 宿主A（全局素材盒浮窗）文件不存在', () => {
    const revived = BANNED_FILES.filter((relative) => fs.existsSync(path.join(repoRoot, relative)))
    expect(revived, `宿主A 文件被恢复（违反方案一，见 docs/plan/2026-07-22-asset-surface-reconvergence.md）：${revived.join(', ')}`).toEqual([])
  })

  it('②「打开素材盒」入口只在浏览器域（src/ui/browser/）', () => {
    const offenders = sourceFiles.filter((file) => {
      if (path.relative(repoRoot, file).startsWith(ASSET_BOX_ALLOWED_DIR)) return false
      return fs.readFileSync(file, 'utf8').includes(ASSET_BOX_ENTRY_MARK)
    })
    expect(
      offenders.map((file) => path.relative(repoRoot, file)),
      '素材盒入口出现在浏览器域之外（顶栏/库页常驻入口已于方案一删除，不许回来）',
    ).toEqual([])
  })

  it('③ 全局素材盒事件族标识符全仓零引用', () => {
    const hits: string[] = []
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8')
      for (const identifier of BANNED_IDENTIFIERS) {
        if (content.includes(identifier)) hits.push(`${path.relative(repoRoot, file)} → ${identifier}`)
      }
    }
    expect(hits, '全局素材盒事件族被重新引用（宿主A 复活信号）').toEqual([])
  })
})
