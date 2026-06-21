// 共享 app 桥 —— 复用 Nomi app 已配模型(文本/视觉/图像)发请求。单一启动点(避免多模块各启 app 撞单实例锁)。
// 机制(照 tests/ux/r1-upload-verify.mjs):key 是 safeStorage 加密、绑 app 身份,纯 Node 解不开 →
//   启真 app,密文传进主进程 safeStorage 解密 + 主进程内 fetch(明文 key 不回传 Node)。
//   ⚠️ 启真 app → 运行时 Nomi 必须关着(单实例锁)。effect-first:自动从 catalog 挑 enabled 模型,免手填。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadCatalog() {
  const p = path.join(os.homedir(), "Library", "Application Support", "nomi", "model-catalog.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** 把 vendor.baseUrlHint 规整成 root(去掉尾部 /v1),调用时统一拼 /v1+path。 */
function vendorOf(catalog, vendorKey) {
  const v = (catalog.vendors || []).find((x) => x.key === vendorKey);
  const rec = (catalog.apiKeysByVendor || {})[vendorKey];
  if (!v || !rec || !rec.apiKey) return null;
  return {
    vendorKey,
    root: String(v.baseUrlHint || "").replace(/\/v1\/?$/, "").replace(/\/$/, ""),
    cipher: rec.apiKey,
    enc: rec.enc,
  };
}

function pickModel(catalog, predicate) {
  // 跳过 vendor 没配 key 的模型(如 kie 在 catalog 里 enabled 但无 apiKey)。
  for (const m of catalog.models || []) {
    if (!m.enabled || !predicate(m)) continue;
    const vendor = vendorOf(catalog, m.vendorKey ?? m.vendor);
    if (!vendor) continue;
    return { modelKey: m.modelKey ?? m.key, ...vendor };
  }
  return null;
}

const isVision = (m) => /vision|multimodal|image[-_]?input/i.test(JSON.stringify(m));
const isImageGen = (m) => m.kind === "image";
const isText = (m) => m.kind === "text" && !isVision(m);

export function resolveModels() {
  const c = loadCatalog();
  return {
    text: pickModel(c, isText) ?? pickModel(c, (m) => m.kind === "text"),
    vision: pickModel(c, isVision),
    image:
      pickModel(c, (m) => isImageGen(m) && /gpt-image-2/i.test(m.modelKey ?? m.key ?? "")) ??
      pickModel(c, isImageGen),
  };
}

let _app = null;
async function ensureApp() {
  if (_app) return;
  _app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
  await _app.firstWindow();
  await new Promise((r) => setTimeout(r, 1200));
}
export async function closeApp() {
  if (_app) {
    await _app.close();
    _app = null;
  }
}

/** 主进程内:解密 cfg.cipher → fetch(cfg.root + /v1 + path)。返回 {status, json} 或 {error}。 */
async function fetchViaApp(cfg, pathSuffix, body) {
  await ensureApp();
  return _app.evaluate(
    async ({ safeStorage }, a) => {
      let key = "";
      try {
        key = a.enc === "safeStorage" ? safeStorage.decryptString(Buffer.from(a.cipher, "base64")) : a.cipher;
      } catch (e) {
        return { error: "decrypt: " + String(e) };
      }
      if (!key) return { error: "decrypted empty" };
      try {
        const resp = await fetch(`${a.root}/v1${a.pathSuffix}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + key },
          body: JSON.stringify(a.body),
        });
        const text = await resp.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* non-json */
        }
        return { status: resp.status, json, raw: json ? null : text.slice(0, 400) };
      } catch (e) {
        return { error: "fetch: " + String(e) };
      }
    },
    { cipher: cfg.cipher, enc: cfg.enc, root: cfg.root, pathSuffix, body },
  );
}

/** 文本聊天(loop 的查/修用)。返回 content string。 */
export async function chatText(system, user) {
  const m = resolveModels().text;
  if (!m) throw new Error("无 enabled 文本模型");
  const r = await fetchViaApp(m, "/chat/completions", {
    model: m.modelKey,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0,
    response_format: { type: "json_object" },
  });
  if (r.error || !r.json) throw new Error(`chatText ${r.status ?? ""}: ${r.error ?? r.raw ?? "?"}`);
  return r.json.choices?.[0]?.message?.content ?? "{}";
}

/** 视觉读图(半客观 VLM 检查)。imageUrl 可 http/data URL。返回 content string。
 *  全在主进程做:解密 + (http 则主进程抓图转 base64,用主进程代理/session)+ 调模型。
 *  注:① 视觉模型如 moonshot 不抓外部 URL、要 base64 ② Node 侧 fetch 可能因代理抓不到外网,
 *  主进程有代理故在那抓 ③ vision-preview 不支持 response_format(会返空)→ 不设,靠 prompt + 稳健解析。 */
export async function chatVision(imageUrl, question) {
  await ensureApp();
  const m = resolveModels().vision;
  if (!m) throw new Error("无 enabled 视觉模型");
  const r = await _app.evaluate(
    async ({ safeStorage }, a) => {
      let key = "";
      try {
        key = a.enc === "safeStorage" ? safeStorage.decryptString(Buffer.from(a.cipher, "base64")) : a.cipher;
      } catch (e) {
        return { error: "decrypt: " + String(e) };
      }
      let dataUrl = a.imageUrl;
      if (/^https?:/i.test(a.imageUrl)) {
        try {
          const ir = await fetch(a.imageUrl);
          const buf = Buffer.from(await ir.arrayBuffer());
          dataUrl = `data:${ir.headers.get("content-type") || "image/jpeg"};base64,${buf.toString("base64")}`;
        } catch (e) {
          return { error: "img fetch: " + String(e) };
        }
      }
      try {
        const resp = await fetch(`${a.root}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + key },
          body: JSON.stringify({
            model: a.modelKey,
            messages: [{ role: "user", content: [{ type: "text", text: a.question }, { type: "image_url", image_url: { url: dataUrl } }] }],
            temperature: 0,
          }),
        });
        const data = await resp.json();
        return { content: data.choices?.[0]?.message?.content ?? "" };
      } catch (e) {
        return { error: "fetch: " + String(e) };
      }
    },
    { cipher: m.cipher, enc: m.enc, root: m.root, modelKey: m.modelKey, imageUrl, question },
  );
  if (r.error) throw new Error(`chatVision: ${r.error}`);
  return r.content ?? "";
}

/** 生成一张图(OpenAI images API)。返回 {url} 或 {b64} 或 {error}。 */
export async function genImage(prompt, size = "1024x1024") {
  const m = resolveModels().image;
  if (!m) throw new Error("无 enabled 图像模型");
  const r = await fetchViaApp(m, "/images/generations", { model: m.modelKey, prompt, n: 1, size });
  if (r.error || !r.json) return { error: `genImage ${r.status ?? ""}: ${r.error ?? r.raw ?? "?"}`, model: `${m.vendorKey}/${m.modelKey}` };
  const d = r.json.data?.[0] ?? {};
  // ⚠️ 多数 vendor(apimart/kie…)图像是**异步任务**:返回 task_id,正确取结果须走 Nomi runtime 的
  // archetype 轮询(runTask,按 mapping 的 query path 模板)。**不在此重写轮询(并行版 P1)**——
  // 真生成接 runTask(headless 全链路,plan 迁移收尾)。这里只对同步返回 url/b64 的 vendor 直出。
  if (d.task_id && !d.url && !d.b64_json) {
    return { pending: true, taskId: d.task_id, model: `${m.vendorKey}/${m.modelKey}`, note: "async task — 真图须走 runTask 轮询" };
  }
  return { url: d.url ?? null, b64: d.b64_json ?? null, model: `${m.vendorKey}/${m.modelKey}` };
}

export function modelLabels() {
  const m = resolveModels();
  return {
    text: m.text ? `${m.text.vendorKey}/${m.text.modelKey}` : null,
    vision: m.vision ? `${m.vision.vendorKey}/${m.vision.modelKey}` : null,
    image: m.image ? `${m.image.vendorKey}/${m.image.modelKey}` : null,
  };
}
export function textAvailable() {
  return resolveModels().text != null;
}
