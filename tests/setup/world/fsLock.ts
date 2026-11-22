// 写盘锁（D-test-world-owner-only 表 A）：测试手写主人存盘文件，在写的那一刻报错。
// 给 node:fs 的写 API 打补丁并 syncBuiltinESMExports；判决见 tests/world/fsJudge.ts。
// 看不见子进程写（python、shell 的 cp）——这是设计卡「做不到」里写明的缺口。
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { installLockRuntime } from "../../world/lockRuntime";
import { judgeWrite, parseStack } from "../../world/fsJudge";
import { inject } from "vitest";

// 同一个子进程会连着跑多个测试文件：补丁只打一次，当前文件的运行时挂在 globalThis 上，补丁每次读最新的。
type FsLockGlobal = { __nomiFsLockRuntime?: ReturnType<typeof installLockRuntime>; __nomiFsLockPatched?: boolean };
const G = globalThis as FsLockGlobal;
// 名字表由主进程（tests/setup/worldGlobal.ts）取自产品里的两张表，这里不 import 产品模块（会让后面的 vi.mock 落空）。
const OWNER_FILE_NAMES: ReadonlySet<string> = new Set(inject("worldOwnerFileNames"));
G.__nomiFsLockRuntime = installLockRuntime("fsLock");

function pathOf(target: unknown): string {
  if (typeof target === "string") return target;
  if (target instanceof URL) return target.pathname;
  if (Buffer.isBuffer(target)) return target.toString();
  return "";
}

/** 目标树里的主人文件名：单个路径看文件名；cp 一个目录要递归看里面有没有主人文件。 */
function ownerNamesAt(src: string | null, dest: string): string[] {
  const names = new Set<string>();
  const base = path.basename(dest);
  if (OWNER_FILE_NAMES.has(base)) names.add(base);
  if (src) {
    try {
      const walk = (p: string, depth: number) => {
        const st = fs.statSync(p);
        if (st.isDirectory() && depth < 8) for (const n of fs.readdirSync(p)) walk(path.join(p, n), depth + 1);
        else if (OWNER_FILE_NAMES.has(path.basename(p))) names.add(path.basename(p));
      };
      walk(src, 0);
    } catch {
      /* 源不存在就交给 fs 自己报错 */
    }
  }
  return [...names];
}

function check(names: string[], target: string): void {
  if (names.length === 0) return;
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 80;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = limit;
  const verdict = judgeWrite(parseStack(stack));
  if (!verdict.block) return;
  const name = names[0];
  G.__nomiFsLockRuntime?.violation({
    detail: { name, target, reason: verdict.reason },
    message:
      `world_file_hand_written: ${target}（${name}）属于主人模块。测试世界只能经 tests/world 的 buildWorld(spec) 造；` +
      `测旧版数据用 seedOldUserData('<目录名>')；测坏数据用 damageWorldFile(world, '<文件>', '<坏法>')。\n` +
      `见 docs/plan/2026-11-22-test-world-owner-only.md「新测试入口」。`,
  });
}

type Fn = (...args: unknown[]) => unknown;
/** argIndex = 目标路径在第几个参数；srcIndex = 源（copy / cp）在第几个，-1 表示没有。 */
function wrap(obj: Record<string, unknown>, key: string, argIndex: number, srcIndex = -1): void {
  const orig = obj[key] as Fn | undefined;
  if (typeof orig !== "function") return;
  obj[key] = function patched(this: unknown, ...args: unknown[]) {
    const dest = pathOf(args[argIndex]);
    if (dest) check(ownerNamesAt(srcIndex >= 0 ? pathOf(args[srcIndex]) || null : null, dest), dest);
    return orig.apply(this, args);
  };
}

if (!G.__nomiFsLockPatched) {
  G.__nomiFsLockPatched = true;
  const f = fs as unknown as Record<string, unknown>;
  const p = fs.promises as unknown as Record<string, unknown>;
  for (const [key, dest, src] of [
    ["writeFileSync", 0, -1], ["writeFile", 0, -1], ["appendFileSync", 0, -1], ["appendFile", 0, -1],
    ["copyFileSync", 1, 0], ["copyFile", 1, 0], ["cpSync", 1, 0], ["cp", 1, 0],
    ["renameSync", 1, -1], ["rename", 1, -1], ["createWriteStream", 0, -1],
  ] as const) {
    wrap(f, key, dest, src);
    wrap(p, key, dest, src);
  }
  syncBuiltinESMExports();
}
