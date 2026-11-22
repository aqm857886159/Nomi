// 写盘锁的判决（纯函数，锁和单测共用）：写主人存盘文件的那一刻，看调用栈里「谁调进了产品」。
// 直接调用者规则（设计卡表 A）：从写的那一帧往外走，先是一段连续的产品帧，再往外那一帧就是调用者。
//   ① 第一帧就是测试代码（测试自己写）                                  → 拦
//   ② 调用者是测试，产品段最外层是存盘原语 jsonFile / configFileStore     → 拦（测试拿原语写手写内容）
//   ③ 调用者是测试，产品段最外层是主人模块，测试不在主人自己的目录        → 拦（越过 buildWorld 直调主人写口）
// 调用者是 tests/world 里的帧（buildWorld / seedOldUserData / damageWorldFile）一律放行；测试驱动 IPC、服务、迁移
// 这类产品代码、由产品自己去写的，一律放行。
import { isOwnerModule, isTestSideFile, repoRelative } from "./ownerModules";

export type StackFrame = { file: string; fn: string };
export type FrameKind = "internal" | "world" | "test" | "product";
export type Verdict = { block: false } | { block: true; reason: "first-frame-test" | "raw-primitive" | "owner-write-path" };

/** 主人自己的目录：这些目录里的测试本来就要测主人的写口。 */
const OWNER_HOMES: ReadonlyArray<readonly string[]> = [
  ["electron/catalog"],
  ["electron/projects", "electron/workspace"],
  ["electron/settings"],
  ["src/desktop", "src/config"],
];

export function frameKind(file: string): FrameKind {
  const rel = repoRelative(file);
  if (!rel || rel.startsWith("node_modules/") || rel.includes("/node_modules/")) return "internal";
  if (rel.startsWith("tests/setup/world/")) return "internal";
  if (rel.startsWith("tests/world/") && !isTestSideFile(rel)) return "world";
  if (isTestSideFile(rel)) return "test";
  return "product";
}

function inOwnerHome(testRel: string, ownerRel: string): boolean {
  const ownerDir = ownerRel.slice(0, ownerRel.lastIndexOf("/"));
  const home = OWNER_HOMES.find((group) => group.includes(ownerDir));
  const dirs = home ?? [ownerDir];
  return dirs.some((dir) => testRel.startsWith(`${dir}/`));
}

export function judgeWrite(rawFrames: StackFrame[]): Verdict {
  const frames = rawFrames.map((f) => ({ ...f, kind: frameKind(f.file) })).filter((f) => f.kind !== "internal");
  if (frames.length === 0) return { block: false };
  const first = frames[0];
  if (first.kind === "world") return { block: false };
  if (first.kind === "test") return { block: true, reason: "first-frame-test" };
  let i = 0;
  while (i < frames.length && frames[i].kind === "product") i += 1;
  const outerProduct = frames[i - 1];
  const caller = frames[i];
  if (!caller || caller.kind !== "test") return { block: false };
  const productRel = repoRelative(outerProduct.file) ?? "";
  if (productRel === "electron/jsonFile.ts" || productRel === "electron/configFileStore.ts") return { block: true, reason: "raw-primitive" };
  const testRel = repoRelative(caller.file) ?? "";
  if (isOwnerModule(outerProduct.file) && !inOwnerHome(testRel, productRel)) return { block: true, reason: "owner-write-path" };
  return { block: false };
}

/** 解析 `new Error().stack`：每行取绝对路径和函数名；node 内部帧忽略。 */
export function parseStack(stack: string): StackFrame[] {
  const out: StackFrame[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const m = /^\s*at (?:async )?(?:(.+?) \()?((?:file:\/\/)?\/[^():]+?)(?::\d+:\d+)\)?$/.exec(line);
    if (!m) continue;
    out.push({ fn: m[1] ?? "", file: m[2].startsWith("file://") ? decodeURIComponent(m[2].slice(7)) : m[2] });
  }
  return out;
}
