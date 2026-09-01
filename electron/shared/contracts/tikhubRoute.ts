// TikHub 手动线路模式的**中立契约单一 owner**（electron/shared/contracts/ = renderer+main 都可合法 import，
// 见 .dependency-cruiser.mjs 的 src-no-import-electron 豁免）。
//
// 为什么在这儿：这个枚举既被主进程选路层用（electron/connectors/tikhubRoute.ts），又要跨 IPC 出现在
// 渲染层的高级设置「线路」行（src/desktop/bridgeConnector.ts 的 DTO）。同 ApiKeyDecryptStatus 的做法：
// 立成中立 owner，两侧都从它 derive，消掉跨进程重复（R14.1 单一语义 owner）。
//
//   · auto ：默认，实测选路（连接时赛跑两候选域 + sticky + 主挂自动切备）。
//   · io   ：强制主域 api.tikhub.io。
//   · dev  ：强制大陆加速域 api.tikhub.dev。

export const TIKHUB_ROUTE_MODES = ["auto", "io", "dev"] as const;

export type TikhubRouteMode = (typeof TIKHUB_ROUTE_MODES)[number];
