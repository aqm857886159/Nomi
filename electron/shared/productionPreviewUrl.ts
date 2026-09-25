// 旧版制作落地写进画布节点结果的 `nomi-local://production-preview/…?preview=<签名>` → 素材库永久地址。
//
// 为什么需要它（2026-09-25）：Agent 付费卡 / 多镜批次出片后，画布落地把产物投成**签名预览链**写进了
// 节点的 result.url。那个签名 5 分钟过期（artifactProjection 的 DEFAULT_TTL_MS），过期后协议层按 404 处理——
// 节点上的片子过几分钟就放不出来，重开项目也一样。现在落地改用素材库地址（与普通生成落地的是同一种）；
// 已经存进项目文件里的旧结果在加载时按这里改写一次。
//
// 两种地址指向的是同一个项目里的同一个文件：签名链路径段里带着的就是项目相对路径，签发时已校验过它在项目内。
// 这里只做格式改写，不放宽任何访问范围（asset 协议本来就只服务项目内相对路径）。
const PRODUCTION_PREVIEW_PREFIX = "nomi-local://production-preview/";

/** 是旧版签名预览链就返回对应的素材库地址；否则 null（调用方原样保留）。 */
export function assetUrlForProductionPreview(url: string | undefined | null): string | null {
  if (typeof url !== "string" || !url.startsWith(PRODUCTION_PREVIEW_PREFIX)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // 路径段：<projectId>/<runId>/<artifactId>/<项目相对路径…>（每段各自 encodeURIComponent）。
  const segments = parsed.pathname.replace(/^\/+/, "").split("/");
  if (segments.length < 4) return null;
  const [projectId, , , ...relative] = segments;
  const decoded = (segment: string): string | null => {
    try { return decodeURIComponent(segment); } catch { return null; }
  };
  const unsafe = (segment: string): boolean => {
    const plain = decoded(segment);
    return !plain || plain === "." || plain === ".." || /[\\/]/.test(plain);
  };
  if (!projectId || unsafe(projectId) || relative.length === 0 || relative.some(unsafe)) return null;
  return `nomi-local://asset/${projectId}/${relative.join("/")}`;
}
