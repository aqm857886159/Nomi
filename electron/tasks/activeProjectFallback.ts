// 结果本地化的防御纵深（2026-07-31 群反馈「生成的视频第二天就加载不出来了」根因层）：
// 生成结果只有在 projectId 到达主进程时才会 importRemoteAsset 落盘；projectId 由渲染层
// taskApi 用 getDesktopActiveProjectId() 兜进 payload——activeProjectId 空窗（hydrate 前、
// 项目切换瞬间、重启后找回）时主进程静默跳过本地化，把厂商临时 CDN URL 直接存进
// node.result.url，链接过期即裂。这里保存的只是 main-owned Surface committed selection
// 投影，供 runtime 各 projectId 读点在 payload 缺失时兜底；它不参与能力资格判断，Surface
// suspend/release 会同步投影为空。payload 带了绝不覆盖。
let activeProjectId = "";

export function rememberActiveProjectForTasks(projectId: string): void {
  activeProjectId = typeof projectId === "string" ? projectId.trim() : "";
}

export function activeTaskProjectFallback(): string {
  return activeProjectId;
}

/**
 * projectId 仍然为空（无窗口、无头调用等确实没有项目上下文）时的资产形状：
 * 绝不再「只存 url」——把厂商临时链接同时写进 providerUrl，明确标记「这是易失的 CDN 链接」，
 * 让播放/参考侧的 url→providerUrl 兜底链有链可退、渲染层的补救本地化认得出它。
 */
export function unlocalizedTaskAsset(
  type: "image" | "video" | "audio" | "model3d",
  url: string,
): { type: typeof type; url: string; thumbnailUrl: string | null; providerUrl: string | null } {
  return {
    type,
    url,
    thumbnailUrl: type === "image" ? url : null,
    providerUrl: /^https?:\/\//i.test(url) ? url : null,
  };
}
