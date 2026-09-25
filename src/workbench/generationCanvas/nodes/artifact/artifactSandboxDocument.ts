// 把 Agent 手写的 HTML 变成「可以安全塞进 srcdoc 的那份文档」。
//
// 为什么不是直接 `<iframe src="nomi-local://…">`（真机逐项验过才换的做法）：
// 主窗开着跨源隔离（COOP: same-origin + COEP，模式的唯一定义见 electron/shared/crossOriginIsolation.ts）。
// 在这个前提下，**任何跨源文档都不能当 frame 加载**——给产物响应补上 COEP 也救不回来（require-corp、credentialless 都挡），
// Chromium 一律 ERR_BLOCKED_BY_RESPONSE。最小 Electron 探针逐个开关试过：
//   隔离开 + 子文档带 COEP → 挡；隔离开 + 不带 → 挡；隔离关 → 通。
// 而关掉隔离是整个 app 的能力回退（画板抠图的多线程 WASM 要 SharedArrayBuffer），不能为一个节点让路。
//
// 走 srcdoc 还有一个附带好处：宿主的 `frame-src` 一格都不用动（阳性对照：改回 `'none'` 走查照样绿）。
// 显示不受信内容**没有**让 app 多开任何口子。
//
// srcdoc 文档不发网络请求，它**继承创建者的上下文**，因此不受这条跨源规则约束；
// 配上 `sandbox="allow-scripts"`（无 allow-same-origin）它仍然是 opaque origin。
// 代价是：没有响应，就没有响应头 CSP——所以策略必须**写进文档里**（meta），这就是本模块。
//
// 阳性对照（同一探针）：带 meta 时产物的 `<img src=https://…>` 与 `fetch(https://…)` 分别报出
// img-src / connect-src 违规；去掉 meta，那张图就加载了。跨源本身只挡得住 fetch，
// 挡不住 `<img>` 这种 no-cors 请求——**真正封住出站的是这份 meta**，不是「反正是跨源」。
import { LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY } from '../../../../../electron/shared/localArtifactPolicy'

const HEAD_OPEN = /<head\b[^>]*>/i
const HTML_OPEN = /<html\b[^>]*>/i
const DOCTYPE = /^\s*<!doctype[^>]*>/i

function policyMeta(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}">`
}

/**
 * 在产物文档里插入策略 meta，插在**解析器读到任何其它内容之前**——meta 形式的 CSP 只管住
 * 它后面的内容，插晚了等于没插。Agent 手写的 HTML 什么形状都可能有，所以按三档退让：
 * 有 `<head>` 就紧跟其后；只有 `<html>` 就补一个 head；都没有（片段）就放最前面，
 * 但要让过 doctype（doctype 必须是文档第一个东西，插它前面会让页面掉进怪异模式）。
 *
 * 产物自己若也带了 meta CSP：不删。多条 CSP 是**取交集**的，只会更严，不会更松。
 */
export function withArtifactSandboxPolicy(
  html: string,
  policy: string = LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY,
): string {
  const meta = policyMeta(policy)
  const head = HEAD_OPEN.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return html.slice(0, at) + meta + html.slice(at)
  }
  const htmlTag = HTML_OPEN.exec(html)
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length
    return `${html.slice(0, at)}<head>${meta}</head>${html.slice(at)}`
  }
  const doctype = DOCTYPE.exec(html)
  const at = doctype ? doctype[0].length : 0
  return html.slice(0, at) + meta + html.slice(at)
}
