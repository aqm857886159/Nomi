/**
 * Durability barrier —— 全仓唯一决定「要不要真的 fsync」的地方。
 *
 * ## 这是干嘛的
 *
 * 写盘分两步：`write()` 只把字节交给操作系统的页缓存，`fsync()` 才逼它落到物理介质。
 * 少了 fsync，进程正常退出数据也读得到（页缓存还在），但**掉电/内核崩溃**时那批字节会丢，
 * 追加式日志可能只写进去半行 —— 事件日志一旦撕裂，整个 run 就重放不出来了。
 * 所以生产必须 fsync，见 `jsonFile.ts` 顶部注释里 `project.json` 那个失败模式。
 *
 * ## 为什么允许关掉
 *
 * fsync 保的是「跨崩溃活下来」。单测把数据写进 `os.mkdtemp()` 建的临时目录、进程退出即丢，
 * **没有任何消费者需要它跨崩溃存活** —— 这个保证在测试里值恰好为零。
 *
 * 而它的成本不是零：实测本机 macOS APFS 上单次 fsync 空载 ~5 ms、全量套件并行时 ~10–11 ms
 * （并行 worker 的 fsync 在同一设备上排队）。productionRun 的编排测试每个文件要落 100–500 次，
 * 于是最重的几个测试墙钟贴在 4.9 s 上、撞 Vitest 默认的 5000 ms `testTimeout` —— 红不红取决于
 * 那一刻磁盘队列多深，就是 flake。关掉后同一批测试 4907 ms → 298 ms（16×），
 * productionRun 子集总测试时间 98.7 s → 4.95 s（20×，超线性是因为顺带消掉了 I/O 争用）。
 *
 * 关掉**不改变任何被测行为**：写入的字节、顺序、文件内容全都一样，只是少了一道落盘屏障。
 *
 * ## 纪律
 *
 * - 默认恒为 `'durable'`。**生产代码不读任何环境变量来决定要不要 fsync。**
 * - 全仓只有 `tests/setup/durability.ts` 一处会翻成 `'ephemeral'`，由 vitest `setupFiles` 挂上。
 *   开关在 harness 层 = 将来新增的测试自动就在 ephemeral 下跑，**不可能忘记**（P2：整类不复发）。
 * - `electron/durability.test.ts` 钉住反向保证：`'durable'` 模式下必须真的调 `fsyncSync`，
 *   免得哪天生产的落盘屏障被悄悄削掉还没人发现（P1：不留逃生口）。
 * - 真要断言崩溃语义的测试，自己在 `beforeEach` 里翻回 `'durable'`、`afterEach` 翻回来。
 */

import fs from "node:fs";

export type DurabilityMode = "durable" | "ephemeral";

let mode: DurabilityMode = "durable";

export function setDurabilityMode(next: DurabilityMode): void {
  mode = next;
}

export function getDurabilityMode(): DurabilityMode {
  return mode;
}

/** 供调用方跳过「整套」落盘动作（比如开目录 fd 只为 fsync 它），而不只是跳过 fsync 本身。 */
export function isDurable(): boolean {
  return mode === "durable";
}

/**
 * 生产：真 fsync。测试：no-op。
 *
 * 除本模块外不要直接调 `fs.fsyncSync` —— 这条由 `pnpm run check:heavy-path` 的
 * `unguarded-fsync` 规则把着（不是靠自觉）。唯一的例外形态是「只为 fsync 而开的目录 fd」：
 * 它连 `openSync` 都要省掉，没法用本函数表达，所以在开 fd 之前先 `if (!isDurable()) return`
 * ——屏障一样被尊重，门岗也认这个形态。
 */
export function fsyncIfDurable(fd: number): void {
  if (mode === "durable") fs.fsyncSync(fd);
}

// 有些文件系统 / 平台对「目录 fd」根本不提供 fsync（Windows FlushFileBuffers 对目录句柄一律 EPERM；
// 部分网络盘 EINVAL / ENOTSUP）。这些码表示「没有可等价的目录屏障」，不是数据出了问题——
// 文件本身早已单独 fsync 过，目录项落盘交给文件系统日志。其它错误照抛。
const DIRECTORY_FSYNC_UNSUPPORTED = new Set(["EPERM", "EACCES", "EINVAL", "ENOTSUP", "EISDIR", "EBADF"]);

/**
 * 目录屏障（rename / 新建文件之后让目录项落盘）——全仓唯一实现。
 *
 * 2026-09-03 之前这段逻辑在 6 个模块里各抄一份，其中两份（projectAgentRepository / cutoverManifest）
 * 只兜了 openSync 的错没兜 fsyncSync 的错：Windows 上 openSync 目录能成功、fsyncSync 才抛 EPERM，
 * 于是新建 / 打开任何项目都在主进程炸成 project_agent_unavailable。收口到这里，平台差异只处理一次。
 */
export function fsyncDirectoryIfDurable(directoryPath: string): void {
  if (mode !== "durable") return; // 目录 fd 存在的唯一目的就是被 fsync —— ephemeral 下连 open 都省掉
  let fd: number;
  try {
    fd = fs.openSync(directoryPath, "r");
  } catch (error) {
    if (DIRECTORY_FSYNC_UNSUPPORTED.has(String((error as NodeJS.ErrnoException).code))) return;
    throw error;
  }
  try {
    fs.fsyncSync(fd);
  } catch (error) {
    if (!DIRECTORY_FSYNC_UNSUPPORTED.has(String((error as NodeJS.ErrnoException).code))) throw error;
  } finally {
    fs.closeSync(fd);
  }
}
