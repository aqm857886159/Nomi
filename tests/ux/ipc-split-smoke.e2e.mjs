// 巨壳拆分后的 IPC 接线回归冒烟（runtime.ts / main.ts 拆分专用，规则 13）。
// 验证：app 启动后，被搬走的 export / onboarding / catalog IPC handler 仍注册、
// 仍路由到新模块（exportJobs / exportJobIpc / onboardingIpc / catalogStore /
// catalogCommit）。只验「接线通」——深层逻辑由 792 个单测覆盖；不发真实网络、不写真目录。
import { launchNomiApp } from "./_launchApp.mjs";

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`IPC-SMOKE FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const { app, win } = await launchNomiApp({ name: "ipc-split-smoke", env: { NOMI_E2E_SMOKE: "1" } });

try {

  const r = await win.evaluate(async () => {
    const d = window.nomiDesktop;
    const out = {};
    // 1) 导出 IPC：nomi:exports:status → registerExportJobIpc → exportJobs.getExportJobStatus
    try {
      await d.exports.status("nonexistent-job-id");
      out.exportStatus = "RESOLVED_UNEXPECTED";
    } catch (e) {
      out.exportStatus = String(e?.message || e);
    }
    // 2) 导出 IPC：start-job 缺 projectId → registerExportJobIpc → exportJobs.startExportJob 抛错
    try {
      await d.exports.startJob({});
      out.exportStart = "RESOLVED_UNEXPECTED";
    } catch (e) {
      out.exportStart = String(e?.message || e);
    }
    // 3) onboarding IPC：test-connection 空 baseUrl → registerOnboardingIpc + catalogStore.normalizeProviderKind
    out.onboardTest = await d.onboarding.testConnection({});
    // 4) onboarding IPC：manual-commit 空 → registerOnboardingIpc → catalogCommit.commitManualOpenAiCompatibleModels
    out.onboardCommit = await d.onboarding.manualCommit({});
    // 5) catalog 读 IPC（catalogStore）：health + 列表
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；可选链不会替 Promise await，必须显式等待。
    out.health = await (d.modelCatalog?.health?.() ?? d.modelCatalog?.getHealth?.() ?? null);
    out.vendorCount = (await (d.modelCatalog?.listVendors?.() ?? []))?.length ?? 0;
    return out;
  });

  console.log("  probe result:", JSON.stringify(r));

  // 接线判定：handler 未注册时 invoke 会以 "No handler registered" 拒绝；
  // 下面断言它们各自路由到了真实业务函数（返回业务错/业务结果，而非 "No handler"）。
  assert(/not found/i.test(r.exportStatus), "nomi:exports:status 路由到 exportJobs.getExportJobStatus（未知 job 报 not found）");
  assert(/no handler/i.test(r.exportStatus) === false, "exports:status 非「handler 未注册」");
  assert(/projectId is required/i.test(r.exportStart), "nomi:exports:start-job 路由到 exportJobs.startExportJob（缺 projectId 报错）");
  assert(r.onboardTest && r.onboardTest.ok === false && /http/i.test(r.onboardTest.error || ""), "nomi:onboarding:test-connection 路由到 onboardingIpc（空地址返回业务错）");
  assert(r.onboardCommit && r.onboardCommit.ok === false, "nomi:onboarding:manual-commit 路由到 catalogCommit（空入参优雅失败）");
  assert(r.vendorCount >= 1, "catalog 读 IPC 经 catalogStore 返回内置 vendor");

  console.log(`\nIPC-SMOKE PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  await app.close().catch(() => undefined);
  process.exit(1);
} finally {
  await app.close().catch(() => undefined);
}
