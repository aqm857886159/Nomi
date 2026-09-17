/**
 * 单节点的「字节正在进项目」生命周期事件（IPC 通道 `nomi:assets:localization-started`）。
 *
 * 主进程与渲染层共读的中立契约：一条通道两种用法，不新开第二条。
 * - 生成结果本地化：只发一次、不带 bytes = 开始的信号。
 * - 本地导入：在拷贝流上连发，带 `copiedBytes`/`totalBytes`，首条带 `previewUrl` = 进度。
 *   `phase` 说的是「这一刻在干什么」——比例只覆盖搬字节那一段，它前后各有一段真实耗时
 *   （前面读文件头/ffprobe/转码，后面哈希/落库/认领预览）。少了它，用户先看见一张不动的卡，
 *   再看见一个停在 100% 还转着的圈（2026-09-17，W-08）。
 * 订阅方按 projectId + nodeId 认领；两种用法天然互不相干（生成节点不会同时是导入节点）。
 */
export type AssetLocalizationEvent = {
  projectId: string;
  nodeId: string;
  copiedBytes?: number;
  totalBytes?: number;
  previewUrl?: string;
  /**
   * 导入的哪一段。省略 = 老版本主进程（渲染层按 `copying` 对待，行为不变）。
   * · `preparing` 一个字节都还没搬（读头、ffprobe、转码）
   * · `copying`   正在搬字节，比例有意义
   * · `finalizing` 字节搬完了，还在做哈希 / 落库 / 认领预览——**比例已经是 1，但事情没完**
   */
  phase?: "preparing" | "copying" | "finalizing";
};
