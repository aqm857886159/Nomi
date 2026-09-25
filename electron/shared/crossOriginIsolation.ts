// 宿主页面跨源隔离头的唯一定义（主进程 contentSecurityPolicy.ts 与开发服务器 vite.config.ts 都从这里读）。
//
// 为什么开隔离：画板抠图的 ONNX 多线程 WASM 要 SharedArrayBuffer（4d972c9d）。
// 为什么是 credentialless 而不是 require-corp（2026-09-25）：require-corp 要求**每一个**跨源子资源自带
// Cross-Origin-Resource-Policy 头，第三方站点大多不带——提示词库里 Sora 官方示例视频（cdn.openai.com）、
// youmind / imgedify 的示例封面在 Mac / Linux 版全部被拦（控制台 NotSameOriginAfterDefaultedToSameOriginByCoep）。
// credentialless 下这些 no-cors 请求不带 cookie 发出、不再要求对方带 CORP，隔离照样成立。
// 真机探针（Electron 43.4.1 / Chrome 150，file:// 与 http://127.0.0.1 两种宿主各跑一遍）：
//   require-corp   → openai / youmind / imgedify 失败；http 宿主 crossOriginIsolated=true
//   credentialless → 全部加载；http 宿主 crossOriginIsolated=true、SharedArrayBuffer 在
//   file:// 宿主两种模式下 crossOriginIsolated 都是 false（file 源是不透明源）——打包版从 file:// 加载，
//   换模式不改变它拿不拿得到 SharedArrayBuffer。
export const CROSS_ORIGIN_ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
} as const)
