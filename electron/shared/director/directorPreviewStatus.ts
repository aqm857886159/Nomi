/**
 * 3D-BOX 预演状态词表的唯一 owner：主进程合同、画布读取视图、渲染端写入与预演状态机都从这里取，不各抄一份。
 * none = 没有挂预演；其余三个是预演自己的生命周期。
 */
export const DIRECTOR_PREVIEW_STATUSES = ["none", "rendering", "ready", "failed"] as const;
export type DirectorPreviewStatus = (typeof DIRECTOR_PREVIEW_STATUSES)[number];
