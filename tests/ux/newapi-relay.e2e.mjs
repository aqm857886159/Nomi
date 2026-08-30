// 真实端到端（verify-first，Issue #8）：对着忠实 mock new-api 验证生产接入边界：
//   ① 保存连接只产生 unverified/disabled 模型，不能绕过认证直接执行；
//   ② 手动入口走 httpCertificationStartExisting canonical facade；
//   ③ 同一次逻辑确认重传同一 idempotency key，只形成一个 canonical run。
// 模型真正发布与传输执行由 certification lifecycle integration 覆盖；本脚本不再保留 raw catalog commit 旁路。
//
// 用法：pnpm run build && node tests/ux/newapi-relay.e2e.mjs
import { launchNomiApp, repoRoot } from "./_launchApp.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
const MOCK_PORT = 8799;
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;

function startMock() {
  const p = spawn(process.execPath, [path.join(repoRoot, "tests/transport-spike/newapi-mock.mjs")], {
    env: { ...process.env, NEWAPI_MOCK_PORT: String(MOCK_PORT) }, stdio: "inherit",
  });
  return p;
}

const mock = startMock();
await new Promise((r) => setTimeout(r, 800));

// 隔离 user-data-dir：不污染开发者真实 catalog。
const { app, win } = await launchNomiApp({ name: "newapi-relay", args: ["--disable-gpu"], settleMs: 1200 });
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); }

try {

  // ⓪ 拉取模型：裸地址（不带 /v1）也能拉到（listModels 兜底重试 /v1/models）。
  console.log("\n▶ ⓪ 拉取模型（裸地址兜底 /v1/models）");
  const listed = await win.evaluate(async (base) => window.nomiDesktop.onboarding.listModels({ baseUrl: base, apiKey: "sk-mock", providerKind: "openai-compatible" }), MOCK_BASE);
  check("裸地址拉到模型", !!listed?.ok && (listed.models || []).length === 7, `ok=${listed?.ok} n=${(listed?.models || []).length}`);

  // ① 保存连接：模型必须保持未验证，不能被 raw enable。
  console.log("\n▶ ① 保存未验证 new-api 连接（mock）");
  const configured = await win.evaluate(async (base) => {
    return await window.nomiDesktop.onboarding.httpConnectionConfigure({
      vendorName: "Mock NewAPI", baseUrl: base, apiKey: "sk-mock", providerKind: "openai-compatible",
      models: [{ modelKey: "dall-e-3", kind: "image" }, { modelKey: "kling-v1", kind: "video" }],
    });
  }, MOCK_BASE);
  check("canonical configure ok", !!configured?.ok, configured?.error || `vendor=${configured?.registration?.vendorKey}`);
  const vendorKey = configured?.registration?.vendorKey;

  const models = await win.evaluate((vk) => (window.nomiDesktop.modelCatalog.listModels({ vendorKey: vk }) || []).map((m) => ({
    k: m.modelKey, kind: m.kind, enabled: m.enabled, published: m.published,
  })), vendorKey);
  check("图片模型 kind=image", models.some((m) => m.k === "dall-e-3" && m.kind === "image"));
  check("视频模型 kind=video", models.some((m) => m.k === "kling-v1" && m.kind === "video"));
  check("未认证模型不可发布", models.length === 2 && models.every((m) => m.enabled === false && m.published !== true));

  // ②/③ 真实手动入口 + 不确定响应重传：同 key 必须返回同一个 canonical run。
  console.log("\n▶ ② 启动 canonical certification，并模拟同 key 重传");
  const starts = await win.evaluate(async ({ vk }) => {
    const payload = {
      entryPoint: "manual-ui",
      idempotencyKey: "newapi-relay-user-confirmation-1",
      vendorKey: vk,
      models: [{ modelKey: "dall-e-3", kind: "image" }, { modelKey: "kling-v1", kind: "video" }],
    };
    const first = await window.nomiDesktop.onboarding.httpCertificationStartExisting(payload);
    const retry = await window.nomiDesktop.onboarding.httpCertificationStartExisting(payload);
    return { first, retry };
  }, { vk: vendorKey });
  check("manual canonical start ok", starts.first?.ok === true, starts.first?.error || starts.first?.code);
  check("重传复用 canonical run", starts.first?.ok === true && starts.retry?.ok === true && starts.first.run.id === starts.retry.run.id, `first=${starts.first?.run?.id} retry=${starts.retry?.run?.id}`);
  check("childRunRef 绑定 canonical run", starts.first?.ok === true && starts.first.run.childRunRef?.runId === starts.first.run.id && /^[a-f0-9]{64}$/.test(starts.first.run.childRunRef?.revisionDigest || ""));
} catch (err) {
  check("e2e 异常", false, String(err?.message || err));
} finally {
  await app.close().catch(() => undefined);
  mock.kill();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n═══ new-api 中转 E2E：${pass}/${results.length} 通过 ═══`);
process.exit(pass === results.length ? 0 : 1);
