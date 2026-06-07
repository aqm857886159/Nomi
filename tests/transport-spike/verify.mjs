// Transport 描述符验证 spike（用假 key 打真实供应商端点，验证"请求形状"是否正确）。
//
// 判读逻辑（假 key 下）：
//   401/403 + "invalid key/auth" → ✅ 形状对：到达供应商、请求被理解，仅 key 被拒
//   400/422 → ⚠️ 请求体可能不对（供应商说 bad request，不是 key 问题）
//   404     → ❌ endpoint 错
//   200     → ⚠️ 假 key 竟通过？（多半响应体里藏 error）
//   网络/超时 → 代理/可达性问题
//
// 目的：证明"一张声明式描述符 + 一个解释器"能为各家构造正确请求。不花钱、不需真 key。
// 用法：node tests/transport-spike/verify.mjs
import { DESCRIPTORS } from "./descriptors.mjs";
import { buildRequest } from "./interpreter.mjs";

const PROXY = "http://127.0.0.1:7897";
let dispatcher;
try { const u = await import("undici"); dispatcher = new u.ProxyAgent(PROXY); } catch {}

const FAKE_KEY = "sk-fake-verify-0000000000000000";
const PARAMS = { model: undefined, prompt: "a small red cat, studio light", size: "1024x1024", aspectRatio: "1:1", n: 1 };

function verdict(status, bodyText) {
  const b = (bodyText || "").toLowerCase();
  // 有的家(kie)HTTP 永远 200，真实状态在 body.code/status —— 必须读 body，不能只看 HTTP 状态。
  let bodyCode;
  try { const j = JSON.parse(bodyText || "{}"); bodyCode = j.code ?? j.status; } catch { /* not json */ }
  if (status === 200 && (bodyCode === 401 || bodyCode === 403)) return "✅ 形状对(到达供应商, key 被拒[状态在 body.code])";
  if (status === 401 || status === 403) return "✅ 形状对(到达供应商, key 被拒)";
  if (status === 400 || status === 422) {
    // 有些家对坏 key 也回 400/401 混用；看 body 是不是 auth 相关
    if (/auth|api key|api-key|invalid token|unauthor|credential/.test(b)) return "✅ 形状对(到达供应商, key 被拒[400])";
    return "⚠️ 请求体可能不对(bad request, 非 key)";
  }
  if (status === 404) return "❌ endpoint 错(404)";
  if (status === 200) return "⚠️ 假 key 竟 200(查响应体 error)";
  if (status === 429) return "✅ 到达供应商(限流 429)";
  return `? HTTP ${status}`;
}

async function run() {
  console.log(`=== 用假 key 验证 ${DESCRIPTORS.length} 家描述符（请求形状是否正确）===\n`);
  for (const d of DESCRIPTORS) {
    const params = { ...PARAMS, model: d.defaultModel };
    let req;
    try { req = buildRequest(d, params, FAKE_KEY); }
    catch (e) { console.log(`[${d.id}] 构造请求失败: ${e.message}`); continue; }
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(req.url, {
        method: req.method, headers: req.headers,
        ...(req.body !== undefined ? { body: typeof req.body === "string" ? req.body : JSON.stringify(req.body) } : {}),
        signal: ctrl.signal, ...(dispatcher ? { dispatcher } : {}),
      });
      clearTimeout(t);
      const txt = await res.text();
      console.log(`[${d.id}] ${d.transport.padEnd(15)} POST ${req.url}`);
      console.log(`        → HTTP ${res.status} | ${verdict(res.status, txt)}`);
      console.log(`        err: ${txt.replace(/\s+/g, " ").slice(0, 130)}`);
    } catch (e) {
      console.log(`[${d.id}] ${d.transport} → 网络失败: ${e.message}`);
    }
    console.log();
  }
}
await run();
