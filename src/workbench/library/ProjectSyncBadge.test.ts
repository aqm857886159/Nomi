import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSyncInspection } from '../../../electron/shared/workspaceSyncContracts'
import { syncFaceOf } from './projectSyncFace'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const badge = stripComments(read('src/workbench/library/ProjectSyncBadge.tsx'))
const page = stripComments(read('src/workbench/library/ProjectLibraryPage.tsx'))

function inspection(status: WorkspaceSyncInspection['status'], missingAssetCount = 0): WorkspaceSyncInspection {
  return {
    status, missingAssetCount, manifestExists: true, backupExists: false,
    referencedAssetCount: 3, observedRevision: 1, lastWriterId: null, contentHash: null,
  }
}

/** 测试里的 `t` 只回键名 + 参数：这条查的是「哪一句放哪一格」，不是译文本身。 */
const t = (key: string, options?: Record<string, unknown>): string =>
  options && 'count' in options ? `${key}:${String(options.count)}` : key

describe('同步角标：角标说状态，完整那句退到悬停与浮层', () => {
  /**
   * 2026-09-11 用户实测：角标被截断。它显示的一直是完整那句
   * （「可在另一台电脑继续」/ "Ready to continue on another computer"），
   * 而卡片列宽只有 minmax(200px, 1fr)、这一行左边还站着更新时间，于是每次都真的在截。
   * 更糟的是 `title` 写的也是同一句被截的话——悬停也读不到新东西。
   */
  it('四种状态的角标都用短词条，完整那句去 title/浮层', () => {
    const cases: [WorkspaceSyncInspection['status'], string, string][] = [
      ['ready', 'library.syncBadgeReady', 'library.syncReady'],
      ['external-change', 'library.syncBadgeExternalChange', 'library.syncExternalChange'],
      ['missing-assets', 'library.syncBadgeMissingAssets:3', 'library.syncMissingAssets:3'],
      ['corrupt-manifest', 'library.syncBadgeCorrupt', 'library.syncCorrupt'],
    ]
    for (const [status, expectedBadge, expectedFull] of cases) {
      const face = syncFaceOf(inspection(status, 3), t)
      expect(face.badge).toBe(expectedBadge)
      expect(face.full).toBe(expectedFull)
      expect(face.badge).not.toBe(face.full)
    }
  })

  /** `conflict` 与 `corrupt-manifest` 是同一句话：这份项目文件此刻读不下去。 */
  it('conflict 走和 corrupt 一样的说法，不掉进没人认领的分支', () => {
    expect(syncFaceOf(inspection('conflict'), t).badge).toBe('library.syncBadgeCorrupt')
  })

  it('角标那颗钮不再截断——短到不需要 truncate，所以 truncate 与 max-w 一并删掉', () => {
    // 只看角标那颗钮自己的 class（浮层里项目路径那一行仍然该 truncate，那是另一回事）。
    const buttonClass = /<button[\s\S]*?className=\{cn\('([^']+)'/.exec(badge)?.[1] ?? ''
    expect(buttonClass).not.toBe('')
    expect(buttonClass).not.toContain('truncate')
    expect(buttonClass).not.toContain('max-w-')
    expect(buttonClass).toContain('whitespace-nowrap')
    expect(badge).toContain('title={face.full}')
  })
})

describe('同步详情浮层：贴被点的那枚角标，不是贴卡片下沿', () => {
  /**
   * 原来是 `absolute right-2 top-full` 挂在卡片上——贴的是「这张卡的下边缘、右对齐」，
   * 跟点的是哪一枚角标无关；卡在网格最后一行时还会被滚动容器切掉。
   * `AnchoredPopover` 是本仓既有的「Portal 到 body + fixed 贴锚点」那份，逃得出祖先 overflow。
   */
  it('走 AnchoredPopover，并且原来那套 absolute 定位已从库页删干净', () => {
    expect(badge).toContain("import { AnchoredPopover } from '../../design'")
    expect(badge).toContain('<AnchoredPopover anchorRef={anchorRef}')
    expect(badge).not.toContain('absolute right-2 top-full')
    expect(page).not.toContain('data-sync-popover')
    expect(page).not.toContain('absolute right-2 top-full')
  })

  /** 原来点外面/按 Esc 都关不掉这枚浮层——`AnchoredPopover` 接了 `onClose` 就有了。 */
  it('接上 onClose，点外面 / Esc 关得掉', () => {
    expect(badge).toContain('onClose={onClose}')
    expect(page).toContain('onClose={() => setOpenSyncProjectId(null)}')
  })
})
