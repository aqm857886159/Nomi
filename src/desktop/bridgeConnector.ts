/**
 * 数据 connector 桥口类型。只从中立契约层 electron/shared/contracts/ 取类型
 * （renderer+main 都可合法 import 的层，见 .dependency-cruiser.mjs 豁免；不碰 electron 实现目录）。
 * v1 只有 TikHub：分享链接 → 无水印直链 → 落项目素材/喂拆解。
 * 形态与语义见 docs/plan/2026-09-01-tikhub-connector-v1.md。
 */
import type { ApiKeyDecryptStatus } from '../../electron/shared/contracts/apiKeyStatus'
import type { TikhubRouteMode } from '../../electron/shared/contracts/tikhubRoute'

export type TikhubKeyStatus = {
  /** key 解密态；成员单一 owner 在 electron/shared/contracts/apiKeyStatus.ts（跨进程不各写一份）。 */
  status: ApiKeyDecryptStatus
  hasKey: boolean
}

export type { TikhubRouteMode }

/** 线路状态（高级设置「线路」行）：当前 mode + 生效域 + 候选域。mode owner 在中立契约层。 */
export type TikhubRouteStatus = {
  mode: TikhubRouteMode
  /** 当前生效线路（auto 下 = sticky 结果，未连接过时空串；手动下 = 锁定域）。 */
  activeHost: string
  hosts: readonly string[]
}

export type TikhubResolvedShareVideo = {
  platform: 'douyin' | 'tiktok'
  /** 无水印/高画质媒体直链（http(s)）。 */
  playUrl: string
  videoId?: string
  /** 该端点名义单价（美元，若文档化）——供 UI 费用确认展示。 */
  unitPriceUsd?: number
}

export type TikhubImportResult = {
  /** 落成的项目视频素材（LocalAssetRecord 形状；含 nomi-local:// URL）。 */
  asset: unknown
  resolved: TikhubResolvedShareVideo
}

export type DesktopConnectorBridge = {
  connector: {
    tikhub: {
      /** key 配置态（永不回传 key 明文）。 */
      keyStatus: () => Promise<TikhubKeyStatus>
      saveKey: (payload: { apiKey: string }) => Promise<TikhubKeyStatus>
      clearKey: () => Promise<TikhubKeyStatus>
      /** 线路状态（当前 mode + 生效域 + 候选域）。永不触网。 */
      routeStatus: () => Promise<TikhubRouteStatus>
      /** 手动指定线路（auto / 强制 io / 强制 dev）。 */
      setRoute: (payload: { mode: TikhubRouteMode }) => Promise<TikhubRouteStatus>
      /** 只解析（不落盘）——用于在落素材/拆解前展示费用确认。失败按三段式（含风控波动诚实提示）。 */
      resolveShareUrl: (payload: { shareUrl: string }) => Promise<TikhubResolvedShareVideo>
      /** 解析 + 落成项目视频素材（带 AssetSourceEvidence，rightsStatus:'unknown'）。 */
      importToProject: (payload: { projectId: string; shareUrl: string }) => Promise<TikhubImportResult>
    }
  }
}
