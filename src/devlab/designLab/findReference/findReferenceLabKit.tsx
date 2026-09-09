import React from 'react'
import { AssetLibraryContent } from '../../../workbench/assets/AssetLibraryPanel'
import { FindReferencePanel } from '../../../workbench/assets/FindReferencePanel'
import { normalizeDouyin, normalizeTiktokAds, normalizeXhs } from '../../../../electron/connectors/referenceSearch'
import douyin from '../../../../electron/connectors/__fixtures__/douyin-search.json'
import xhs from '../../../../electron/connectors/__fixtures__/xhs-search.json'
import tiktok from '../../../../electron/connectors/__fixtures__/tiktok-ads-search.json'
import { REFERENCE_PLATFORMS, type ReferencePlatform } from '../../../../electron/shared/contracts/referenceSearch'

// Existing captured provider responses go through the production normalizers.
// Signed remote covers are omitted: baselines exercise layout, never the network.
const items = {
  douyin: normalizeDouyin(douyin),
  xhs: normalizeXhs(xhs),
  tiktok: normalizeTiktokAds(tiktok),
}

function installBridge(empty: boolean): void {
  ;(window as unknown as { nomiDesktop: unknown }).nomiDesktop = {
    connector: { tikhub: {
      keyStatus: async () => ({ status: 'ok', hasKey: true }),
      searchReferences: async ({ platform, keyword }: { platform: ReferencePlatform; keyword: string }) => ({
        platform,
        items: empty ? [] : items[platform].slice(0, 3).map((item) => ({ ...item, coverUrl: '' })),
        effectiveKeyword: keyword,
        hasMore: false,
      }),
      importReference: async () => ({ assetId: 'lab-reference' }),
    } },
  }
}

function SearchStage({ platform }: { platform: ReferencePlatform }): JSX.Element {
  const [picked, setPicked] = React.useState(platform)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const input = ref.current?.querySelector('input')
    if (!input) return
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, platform === 'tiktok' ? 'skincare serum' : '护肤精华')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const frame = requestAnimationFrame(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    return () => cancelAnimationFrame(frame)
  }, [platform])
  return <div ref={ref} className="w-full">
    <FindReferencePanel projectId="lab-reference" platform={picked} onPlatformChange={setPicked}
      onShareLink={() => undefined} onImported={() => undefined} onNeedKey={() => undefined} />
  </div>
}

/** Real product components and real search event; this is a specimen, not a live-provider receipt. */
export function FindReferenceStage({ emptyEntry = false, allPlatforms = false, emptyResults = false }: { emptyEntry?: boolean; allPlatforms?: boolean; emptyResults?: boolean }): JSX.Element {
  React.useMemo(() => installBridge(emptyResults), [emptyResults])
  return <div data-design-lab-stage="find-reference" className="flex overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper"
    style={{ width: allPlatforms ? 1260 : 420, minHeight: allPlatforms ? 620 : 520 }}>
    {emptyEntry ? <AssetLibraryContent projectId={null} />
      : allPlatforms ? <>{REFERENCE_PLATFORMS.map((platform) => <SearchStage key={platform} platform={platform} />)}</>
      : <SearchStage platform={emptyResults ? 'tiktok' : 'douyin'} />}
  </div>
}
