// 项目库卡片上「找不到文件夹」的说法（「项目在哪」收敛单第二轮）。
//
// 文件夹找不到的项目一直留在库里（列表不再摘登记）。卡片以前在名字下面挂的是同步角标——它对一个不存在的文件夹只会说
// 「文件异常」，弹层里的「打开文件夹 / 重新检查」也都无从做起；右下角还躺着一颗打不开任何东西的「打开项目文件夹」。
// 现在：找不到的卡，名字下面一直写着一句事实（不只悬停才看见），颜色和同步角标的"出事了"同一档；不放角标、不放打开文件夹的钮。
// 文件夹在、只是清单读不下去的卡，照旧由同步角标说「文件异常」。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSyncInspection } from '../../../electron/shared/workspaceSyncContracts'
import type { LocalProjectSummary } from './localProjectStore'
import { SYNC_TONE_CLASS } from './projectSyncFace'

const state = vi.hoisted(() => ({
  projects: [] as unknown[],
  inspections: {} as Record<string, unknown>,
}))

// 测试里的 `t` 只回键名：查的是「哪一句放哪一格」，不是译文本身。
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../ui/app-shell/shell/ShellFrame', () => ({
  ShellFrame: ({ topBar, children }: { topBar: React.ReactNode; children: React.ReactNode }) => React.createElement(React.Fragment, null, topBar, children),
}))
vi.mock('../../ui/app-shell/shell/ShellTopBar', () => ({ ShellTopBar: () => null }))
vi.mock('../../ui/app-shell/UpdateNotices', () => ({ UpdateNotices: () => null }))
vi.mock('./localProjectStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./localProjectStore')>()),
  useLocalProjects: () => ({ projects: state.projects, projectsError: null, projectsLoading: false, refreshProjects: () => undefined }),
}))
vi.mock('./projectSyncInspectStore', () => ({
  librarySyncInspect: { request: () => undefined, set: () => undefined },
  useLibrarySyncInspections: () => state.inspections,
}))

import ProjectLibraryPage from './ProjectLibraryPage'

function inspection(status: WorkspaceSyncInspection['status']): WorkspaceSyncInspection {
  return { status, missingAssetCount: 0, manifestExists: false, backupExists: false, referencedAssetCount: 0, observedRevision: null, lastWriterId: null, contentHash: null }
}

function summary(id: string, extra: Partial<LocalProjectSummary>): LocalProjectSummary {
  return { id, name: `项目 ${id}`, createdAt: 1, updatedAt: 1, version: 2, rootPath: `/projects/${id}`, source: 'native', ...extra } as LocalProjectSummary
}

/** 把整页切成一张张卡，按项目 id 取。 */
function cardsOf(html: string): Record<string, string> {
  const cards: Record<string, string> = {}
  for (const chunk of html.split('data-project-card="true"').slice(1)) {
    const id = /data-project-id="([^"]+)"/.exec(chunk)?.[1]
    if (id) cards[id] = chunk
  }
  return cards
}

function render(): Record<string, string> {
  return cardsOf(
    renderToStaticMarkup(
      React.createElement(ProjectLibraryPage, {
        onOpenProject: () => undefined,
        onDeleteProject: () => undefined,
        onNewProject: () => undefined,
        onRevealProjectFolder: () => undefined,
      }),
    ),
  )
}

describe('项目库卡片：文件夹找不到 vs 文件夹在但清单读不下去', () => {
  beforeEach(() => {
    // 真实情形：主进程对不存在的文件夹查同步，回的就是 corrupt-manifest——这正是以前那枚「文件异常」的来源。
    state.projects = [
      summary('gone', { missing: true }),
      summary('broken', { missing: false }),
      summary('fine', { missing: false }),
    ]
    state.inspections = { gone: inspection('corrupt-manifest'), broken: inspection('corrupt-manifest'), fine: { ...inspection('ready'), manifestExists: true } }
  })

  it('找不到文件夹的卡：名字下面一直写着那句事实，悬停是下一步；不放同步角标', () => {
    const gone = render().gone
    expect(gone).toBeTruthy()
    expect(gone).toContain('library.folderMissingBadge')
    expect(gone).not.toContain('data-sync-status')
    expect(gone).not.toContain('library.syncBadgeCorrupt')
    expect(gone).not.toContain('library.syncCorrupt')
    // 那句话本身：不能点（不是按钮）、悬停说下一步、颜色是同步角标"出事了"那一档。
    const tag = /<span[^>]*data-project-folder-missing="true"[^>]*>/.exec(gone)?.[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('title="library.folderMissingHint"')
    expect(tag).toContain(SYNC_TONE_CLASS.danger)
    expect(gone).not.toMatch(/<button[^>]*data-project-folder-missing/)
  })

  it('找不到文件夹的卡：右下角没有「打开项目文件夹」的钮（没有文件夹可开）', () => {
    expect(render().gone).not.toContain('aria-label="library.openProjectFolder"')
  })

  it('文件夹在、清单读不下去的卡：仍由同步角标说「文件异常」，也仍有打开文件夹的钮', () => {
    const broken = render().broken
    expect(broken).toContain('data-sync-status="corrupt-manifest"')
    expect(broken).toContain('library.syncBadgeCorrupt')
    expect(broken).not.toContain('library.folderMissingBadge')
    expect(broken).not.toContain('data-project-folder-missing')
    expect(broken).toContain('aria-label="library.openProjectFolder"')
  })

  it('正常的卡一个字没变：同步角标在、打开文件夹的钮在、没有"找不到"那句', () => {
    const fine = render().fine
    expect(fine).toContain('data-sync-status="ready"')
    expect(fine).toContain('aria-label="library.openProjectFolder"')
    expect(fine).not.toContain('library.folderMissingBadge')
  })
})
