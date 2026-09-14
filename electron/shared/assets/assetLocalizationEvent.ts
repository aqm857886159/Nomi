/**
 * 单节点的「字节正在进项目」生命周期事件（IPC 通道 `nomi:assets:localization-started`）。
 *
 * 主进程与渲染层共读的中立契约：一条通道两种用法，不新开第二条。
 * - 生成结果本地化：只发一次、不带 bytes = 开始的信号。
 * - 本地导入：在拷贝流上连发，带 `copiedBytes`/`totalBytes`，首条带 `previewUrl` = 进度。
 * 订阅方按 projectId + nodeId 认领；两种用法天然互不相干（生成节点不会同时是导入节点）。
 */
export type AssetLocalizationEvent = {
  projectId: string;
  nodeId: string;
  copiedBytes?: number;
  totalBytes?: number;
  previewUrl?: string;
};
