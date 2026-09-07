import type { Session } from "electron";
import { LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY, isLocalArtifactUrl } from "./shared/localArtifactPolicy";

type ContentSecurityPolicyOptions = Readonly<{
  isDev: boolean;
  lowMemoryMode: boolean;
  skipCrossOriginIsolation: boolean;
  skipCrossOriginIsolationForWindowsFrameless: boolean;
  disableCrossOriginIsolation: boolean;
}>;

// 产物策略的定义住在 electron/shared/localArtifactPolicy.ts（渲染层也要用同一份给沙箱文档注入
// meta，见 src/workbench/generationCanvas/nodes/artifact/artifactSandboxDocument.ts）。
// 这里只负责「哪条响应用哪份策略」。
export { LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY, isLocalArtifactUrl } from "./shared/localArtifactPolicy";

/**
 * 随包第三方运行时（onnxruntime-web）的 wasm 加载器是**运行时 fetch 自己的胶水 JS 的**，
 * 所以它必须在 `script-src` 里。给的是 `nomi-local://runtime` 这个**精确 host**，不是整个
 * `nomi-local:` scheme——后者同时伺服项目素材（用户导入的、供应商下载回来的文件），
 * 把它整体放进 script-src 等于说「任何一份素材都可以当脚本执行」。
 * runtime host 只解析随包目录里的白名单文件名（electron/protocol/localRuntimeAssets.ts）。
 */
const RUNTIME_ASSET_SOURCE = "nomi-local://runtime";

function buildContentSecurityPolicy(isDev: boolean): string {
  const common = [
    "default-src 'self' nomi-local:",
    "img-src 'self' nomi-local: https: data: blob:",
    "media-src 'self' nomi-local: https: data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    // 一个 URL 都不放行成 frame。手艺产物（agent-artifact）曾经想走 `src=nomi-local://…`，
    // 那需要在这里开一道口子——**最后没开**：跨源隔离下那条路本来就走不通（见下面 COEP 一段），
    // 产物改走 srcdoc 继承上下文，而 frame-src 管不到 srcdoc（真机阳性对照：这里改回 'none'，
    // 产物走查照样全绿）。既然不需要，就不开——远端/本地文件/data 页面一律进不了画布。
    "frame-src 'none'",
    "worker-src 'self' blob:",
  ];
  if (isDev) {
    return [
      ...common,
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${RUNTIME_ASSET_SOURCE} http://127.0.0.1:5273`,
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' nomi-local: https: ws://127.0.0.1:5273 http://127.0.0.1:5273 blob:",
    ].join("; ");
  }
  return [
    ...common,
    `script-src 'self' 'wasm-unsafe-eval' blob: ${RUNTIME_ASSET_SOURCE}`,
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' nomi-local: https: blob:",
  ].join("; ");
}

export function installContentSecurityPolicy(targetSession: Session, options: ContentSecurityPolicyOptions): void {
  const csp = buildContentSecurityPolicy(options.isDev);
  const crossOriginIsolationDisabled =
    options.lowMemoryMode ||
    options.skipCrossOriginIsolation ||
    options.skipCrossOriginIsolationForWindowsFrameless ||
    options.disableCrossOriginIsolation;
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    // 按 URL 的协议选策略：宿主页面拿宿主策略，nomi-local 产物拿产物策略。
    // （webRequest 会不会对自定义协议触发依 Electron 版本而异——所以协议处理器自己也下发同一
    //  常量，两处收口在同一份定义上；先到先得，结果一致，永不出现「产物没有 CSP」的窗口。）
    const isArtifact = isLocalArtifactUrl(details.url);
    const responseHeaders: Record<string, string[]> = {
      ...details.responseHeaders,
      "Content-Security-Policy": [isArtifact ? LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY : csp],
    };
    // 跨源隔离照旧（画板抠图的多线程 WASM 要 SharedArrayBuffer，见 4d972c9d）。
    // 顺带记一笔真机结论，免得下一个人再试一遍：隔离开着时**跨源文档根本不能当 frame 加载**，
    // 给产物响应补 COEP: require-corp 也救不回来（最小 Electron 探针逐个开关验过：
    // require-corp 挡、credentialless 挡、关掉隔离才通）。所以产物走 srcdoc，不走 src 导航。
    if (!crossOriginIsolationDisabled) {
      responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
      responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
    }
    callback({ responseHeaders });
  });
}
