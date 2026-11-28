/**
 * 全仓**唯一**关掉落盘屏障（fsync）的地方 —— 由 `vitest.config.ts` 的 `setupFiles` 挂上。
 *
 * 为什么：单测把数据写进 `os.mkdtemp()` 的临时目录、进程退出即丢，没有任何消费者需要它跨掉电存活，
 * fsync 在这里的价值恰好为零；成本却是套件的绝大部分耗时（本机实测 productionRun 子集
 * 98.7 s → 4.95 s）。更要命的是它让墙钟随磁盘队列深度漂移 —— 最重的几个 productionRun 测试
 * 因此贴在 Vitest 默认 5000 ms `testTimeout` 上间歇性红。完整根因见
 * `docs/plan/2026-08-25-production-run-test-flake-fsync.md`。
 *
 * 开关放在 harness 层（而不是让每个测试自己传 `durability: 'ephemeral'`）是故意的：
 * 将来新写的测试自动就在 ephemeral 下跑，**不可能忘记**，flake 长不回来。
 *
 * 要断言真·崩溃语义的测试，自己在 `beforeEach` 翻回 `'durable'`、`afterEach` 翻回来 ——
 * `electron/durability.test.ts` 就是这么钉住生产保证的。
 */

import fs from "node:fs";
import { setDurabilityMode } from "../../electron/durability";

// stubborn-fs（atomically 的底层依赖）在模块首次加载时按值捕获 node:fs 的函数引用；
// 先把动态转发挂到 fs 上完成 atomically 预加载，随后立即把原生函数还原回 fs，
// 既让 stubborn-fs 感知后续 vi.spyOn(fs, ...)，又不干扰直接调 fs 的 spy 调用计数。
const FORWARDED_FS_METHODS = [
  "chmod",
  "chown",
  "close",
  "fsync",
  "mkdir",
  "open",
  "readFile",
  "realpath",
  "rename",
  "stat",
  "unlink",
  "write",
  "writeFile",
  "chmodSync",
  "chownSync",
  "closeSync",
  "existsSync",
  "fsyncSync",
  "mkdirSync",
  "openSync",
  "readFileSync",
  "realpathSync",
  "renameSync",
  "statSync",
  "unlinkSync",
  "writeSync",
  "writeFileSync",
] as const;

const fsRecord = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
const originals = new Map<string, (...args: unknown[]) => unknown>();
for (const method of FORWARDED_FS_METHODS) {
  const raw = fsRecord[method];
  if (typeof raw !== "function") continue;
  originals.set(method, raw);
  const original = raw.bind(fs);
  const forwarder = (...args: unknown[]): unknown => {
    const current = fsRecord[method];
    return current === raw || current === forwarder ? original(...args) : current.apply(fs, args);
  };
  if ("native" in raw) {
    Object.defineProperty(forwarder, "native", {
      configurable: true,
      writable: true,
      value: (raw as { native?: unknown }).native,
    });
  }
  fsRecord[method] = forwarder;
}

await import("atomically");

for (const [method, raw] of originals) {
  fsRecord[method] = raw;
}

setDurabilityMode("ephemeral");
