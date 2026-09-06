#!/usr/bin/env node
// ============================================================================
// 门岗：防「本机绝对路径的符号链接」进 git（会让别人 checkout 出来就是坏链）。
//
// 历史上曾把 worktree 的 node_modules 软链到主仓。除了链接一旦进 git 会成为坏链，
// 共享依赖本身也会把 pnpm 相对链接解析到旧 worktree，造成声明 Electron 43、实际运行 31。
// 现在每个 worktree 都必须独立 `pnpm install --prefer-offline`；pnpm store 仍会复用包内容。
//
// 为什么 .gitignore 挡不住（这坑已复发过一次，2026-08-08 修掉、08-11 又回来）：
//   ① 带斜杠的 `node_modules/` 只匹配目录，匹配不上符号链接（符号链接在 git 眼里是文件）
//      → `git add -A` 顺手 staged 进去。08-11 的 e7e69d7c 就是这么混在 11 个源文件里进的。
//   ② 一旦 tracked，.gitignore 就**彻底失效**（gitignore 只管未跟踪路径），
//      `git status` 从此干干净净，肉眼和 review 都看不见它 —— 所以能活 3 天。
//   补斜杠只堵住 ①，堵不住已经 tracked 的 ②，也堵不住将来别人给 dist/ 之类做软链。
//   本门岗守的是**不变量本身**：git 里不许有本机绝对路径的软链，一条顶十条 ignore 规则。
//
// 读的是 index（`git ls-files -s`），所以 `git add` 那一刻就能被 pre-commit 抓到，
// push 前再被 gates 兜一次。仓库内的相对软链是正当用法，放行。
//
// 用法：node scripts/check-no-machine-symlinks.mjs
// 命中 → 打印详情 + 修复命令 + exit 1。干净 → exit 0。
// ============================================================================
import { execSync } from "node:child_process";
import { splitNulPaths } from "./lib/gitPaths.mjs";
import path from "node:path";

const SYMLINK_MODE = "120000"; // git 里符号链接的 mode

function listTrackedSymlinks() {
  // -s 给出 mode，据此筛出符号链接；object id 拿来读链接目标（blob 内容就是目标路径）
  // `-z`：记录用 NUL 分隔，路径原样输出。默认 quotePath 下非 ASCII 路径会被转义并加引号，
  // 后面 `git cat-file` / 报错行拿到的都不是真路径。
  return splitNulPaths(execSync("git ls-files -s -z", { encoding: "utf8" }))
    .map((record) => {
      const [meta, file] = record.split("\t");
      const [mode, oid] = meta.split(" ");
      return { mode, oid, file };
    })
    .filter((e) => e.mode === SYMLINK_MODE);
}

const readTarget = (oid) => execSync(`git cat-file -p ${oid}`, { encoding: "utf8" }).trim();

// 绝对路径（POSIX `/...` 或 Windows `C:\...`）= 铁定只在某台机器上成立
const isAbsolute = (t) => t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t);
// 相对但爬出仓库根，同样不可移植
const escapesRepo = (file, target) => path.relative(".", path.resolve(path.dirname(file), target)).startsWith("..");

const offenders = listTrackedSymlinks()
  .map((e) => ({ ...e, target: readTarget(e.oid) }))
  .filter((e) => isAbsolute(e.target) || escapesRepo(e.file, e.target));

if (offenders.length > 0) {
  console.error("❌ git 里发现指向本机绝对路径 / 仓库外的符号链接——协作者 checkout 出来会是死链：\n");
  for (const o of offenders) {
    console.error(`   ${o.file} -> ${o.target}`);
  }
  console.error("\n修复（保留磁盘上的链接，只把它移出 git）：");
  console.error(`   git rm --cached ${offenders.map((o) => o.file).join(" ")}`);
  console.error("   并确认 .gitignore 里对应规则**不带尾斜杠**（带斜杠只匹配目录，匹配不上符号链接）。\n");
  process.exit(1);
}

console.log("✅ 无本机绝对路径符号链接进 git");
