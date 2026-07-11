import React from 'react'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { NomiBrowserAsset } from './browserAssetData'
import {
  BROWSER_ASSET_LIBRARY_UPDATED_EVENT,
  browserAssetLibraryKey,
  readBrowserAssetLibraryState,
} from './browserAssetLibraryStorage'
import { PERSISTED_ASSET_PAGE_LIMIT } from '../popover/browserAssetPopoverConstants'
import {
  browserAssetFromDesktopAsset,
  browserAssetStorageKey,
  mergeBrowserAssetGroups,
} from '../popover/browserAssetPopoverUtils'

type BrowserAssetCountOptions = {
  projectId?: string | null
  includePromptLibrary?: boolean
}

function resolveBrowserAssetCountProjectId(projectId?: string | null): string {
  return typeof projectId === 'string' ? projectId.trim() : getDesktopActiveProjectId()
}

function countBrowserAssets(assets: readonly NomiBrowserAsset[], includePromptLibrary: boolean): number {
  if (includePromptLibrary) return assets.length
  return assets.filter((asset) => asset.source === 'my').length
}

export function readBrowserAssetCountSnapshot(options: BrowserAssetCountOptions = {}): number {
  const projectId = resolveBrowserAssetCountProjectId(options.projectId)
  const includePromptLibrary = options.includePromptLibrary ?? false
  const state = readBrowserAssetLibraryState(projectId)
  const deletedAssetKeys = new Set(state.deletedAssetKeys)
  const merged = mergeBrowserAssetGroups(state.folders, includePromptLibrary ? state.promptCards : [])
    .filter((asset) => !deletedAssetKeys.has(browserAssetStorageKey(asset)))
  return countBrowserAssets(merged, includePromptLibrary)
}

export async function loadBrowserAssetCount(options: BrowserAssetCountOptions = {}): Promise<number> {
  const projectId = resolveBrowserAssetCountProjectId(options.projectId)
  const includePromptLibrary = options.includePromptLibrary ?? false
  const state = readBrowserAssetLibraryState(projectId)
  const desktop = getDesktopBridge()
  const persistedAssets: NomiBrowserAsset[] = []
  if (projectId && desktop?.assets?.list) {
    let cursor: string | null = null
    do {
      const page = await desktop.assets.list({ projectId, cursor, limit: PERSISTED_ASSET_PAGE_LIMIT })
      for (const asset of page.items) {
        const mapped = browserAssetFromDesktopAsset(asset)
        if (mapped) persistedAssets.push(mapped)
      }
      cursor = page.cursor
    } while (cursor)
  }
  const deletedAssetKeys = new Set(state.deletedAssetKeys)
  const merged = mergeBrowserAssetGroups(state.folders, includePromptLibrary ? state.promptCards : [], persistedAssets)
    .filter((asset) => !deletedAssetKeys.has(browserAssetStorageKey(asset)))
  return countBrowserAssets(merged, includePromptLibrary)
}

export function useBrowserAssetCount(options: BrowserAssetCountOptions = {}): number {
  const { projectId, includePromptLibrary = false } = options
  const [count, setCount] = React.useState(() => readBrowserAssetCountSnapshot({ projectId, includePromptLibrary }))
  const loadIdRef = React.useRef(0)

  React.useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      const nextOptions = { projectId: resolveBrowserAssetCountProjectId(projectId), includePromptLibrary }
      const loadId = ++loadIdRef.current
      setCount(readBrowserAssetCountSnapshot(nextOptions))
      void loadBrowserAssetCount(nextOptions)
        .then((nextCount) => {
          if (!cancelled && loadIdRef.current === loadId) setCount(nextCount)
        })
        .catch(() => {
          if (!cancelled && loadIdRef.current === loadId) setCount(readBrowserAssetCountSnapshot(nextOptions))
        })
    }
    const handleLibraryUpdated = (event: Event): void => {
      const eventProjectId =
        event instanceof CustomEvent && typeof event.detail?.projectId === 'string'
          ? event.detail.projectId
          : ''
      const currentProjectId = resolveBrowserAssetCountProjectId(projectId)
      if (eventProjectId && eventProjectId !== currentProjectId) return
      refresh()
    }
    const handleStorage = (event: StorageEvent): void => {
      const currentProjectId = resolveBrowserAssetCountProjectId(projectId)
      if (event.key && event.key !== browserAssetLibraryKey(currentProjectId)) return
      refresh()
    }
    refresh()
    window.addEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, handleLibraryUpdated)
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      window.removeEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, handleLibraryUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [includePromptLibrary, projectId])

  return count
}
