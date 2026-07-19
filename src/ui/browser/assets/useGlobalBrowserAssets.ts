import React from 'react'
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

type GlobalBrowserAssetsState = {
  assets: NomiBrowserAsset[]
  refresh: () => void
}

function projectIdsFromRecords(records: unknown): string[] {
  if (!Array.isArray(records)) return []
  const ids = new Set<string>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const id = String((record as { id?: unknown }).id || '').trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

export function useGlobalBrowserAssets(): GlobalBrowserAssetsState {
  const [assets, setAssets] = React.useState<NomiBrowserAsset[]>([])
  const [version, setVersion] = React.useState(0)
  const refresh = React.useCallback(() => setVersion((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const desktop = getDesktopBridge()
      if (!desktop?.projects || !desktop.assets?.list) {
        if (!cancelled) setAssets([])
        return
      }
      const records = desktop.projects.listAsync ? await desktop.projects.listAsync() : desktop.projects.list()
      const groups = await Promise.all(projectIdsFromRecords(records).map(async (projectId) => {
        const loaded: NomiBrowserAsset[] = []
        let cursor: string | null = null
        do {
          const page = await desktop.assets.list({ projectId, cursor, limit: PERSISTED_ASSET_PAGE_LIMIT })
          for (const asset of page.items) {
            const mapped = browserAssetFromDesktopAsset(asset)
            if (mapped) loaded.push(mapped)
          }
          cursor = page.cursor
        } while (cursor && !cancelled)
        return loaded
      }))
      if (!cancelled) setAssets(mergeBrowserAssetGroups(...groups))
    }
    void load().catch(() => {
      if (!cancelled) setAssets([])
    })
    return () => {
      cancelled = true
    }
  }, [version])

  return { assets, refresh }
}

export function useGlobalBrowserAssetCount(): number {
  const { assets, refresh } = useGlobalBrowserAssets()
  const [libraryState, setLibraryState] = React.useState(() => readBrowserAssetLibraryState(''))

  React.useEffect(() => {
    const update = (): void => {
      setLibraryState(readBrowserAssetLibraryState(''))
      refresh()
    }
    const handleStorage = (event: StorageEvent): void => {
      if (event.key && event.key !== browserAssetLibraryKey('')) return
      update()
    }
    window.addEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, update)
    window.addEventListener('storage', handleStorage)
    const offAssetsUpdated = getDesktopBridge()?.assets?.onUpdated?.(update)
    return () => {
      window.removeEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, update)
      window.removeEventListener('storage', handleStorage)
      offAssetsUpdated?.()
    }
  }, [refresh])

  const deletedKeys = React.useMemo(() => new Set(libraryState.deletedAssetKeys), [libraryState.deletedAssetKeys])
  return React.useMemo(
    () => mergeBrowserAssetGroups(libraryState.folders, assets)
      .filter((asset) => !deletedKeys.has(browserAssetStorageKey(asset)))
      .filter((asset) => asset.source === 'my')
      .length,
    [assets, deletedKeys, libraryState.folders],
  )
}
