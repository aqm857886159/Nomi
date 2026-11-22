// 换导出锁（D-test-world-owner-only 表 C'）：`vi.mock` / `vi.doMock` 换掉主人模块，在登记那一刻抛。
// 两条路都经 vitest 的 `__vitest_mocker__.queueMock`（vitest 4.1.8：dist/chunks/test.DNmyFkvJ.js 的 mock / doMock）。
// 升 vitest 时由 tests/world/world.locks.test.mjs 里的元测试兜底：门换了，固定夹具就不红。
// 目标是否主人：按 importer 解析成文件，在名单里，或源码 `export … from` 转手名单里的主人，都算。
// `vi.spyOn` 和直接改命名空间不在这里：主人命名空间已由 tests/world/ownerFreezePlugin.ts 冻结，做不出来。
import { installLockRuntime } from "../../world/lockRuntime";
import { isOwnerModule, repoRelative, resolveSpecifier } from "../../world/ownerModules";

type Mocker = { queueMock: (id: string, importer: string, factory: unknown) => void; __nomiWorldWrapped?: boolean };
type ExportLockGlobal = { __vitest_mocker__?: Mocker; __nomiExportLockRuntime?: ReturnType<typeof installLockRuntime> };
const G = globalThis as ExportLockGlobal;

const mocker = G.__vitest_mocker__;
if (!mocker || typeof mocker.queueMock !== "function") {
  throw new Error(
    "world_lock_vitest_internal_missing: vitest 内部的 __vitest_mocker__.queueMock 不存在，换导出锁接不上。\n" +
      "升 vitest 后门换了：先看 tests/world/world.locks.test.mjs 的元测试，再改 tests/setup/world/exportLock.ts。",
  );
}

G.__nomiExportLockRuntime = installLockRuntime("exportLock");

if (!mocker.__nomiWorldWrapped) {
  mocker.__nomiWorldWrapped = true;
  const original = mocker.queueMock.bind(mocker);
  mocker.queueMock = (id: string, importer: string, factory: unknown) => {
    const target = resolveSpecifier(String(id), importer ? String(importer) : null);
    if (target && isOwnerModule(target)) {
      const rel = repoRelative(target) ?? target;
      G.__nomiExportLockRuntime?.violation({
        testFallback: repoRelative(String(importer)) ?? String(importer),
        detail: { module: rel, importer: repoRelative(String(importer)) ?? String(importer) },
        message:
          `owner_module_mock_refused: ${rel} 是主人模块，不许 mock。造世界用 buildWorld，桥用 desktopBridgeForTest，故障用 faultAt。\n` +
          `见 docs/plan/2026-11-22-test-world-owner-only.md「新测试入口」。`,
      });
    }
    return original(id, importer, factory);
  };
}
