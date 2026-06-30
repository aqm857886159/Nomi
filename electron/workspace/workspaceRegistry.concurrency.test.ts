import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listRecentWorkspaces } from "./workspaceRegistry";

// poison「项目不存在」根因回归：注册表无锁 read-modify-write，多进程并发建项目时后写覆盖先写丢条目。
// 确定性复现（修前两进程各写 N 条→丢约一半）。本测起两个真子进程并发猛写，断言一条不丢（锁生效）。
const tsxBin = path.resolve(__dirname, "../../node_modules/.bin/tsx");

describe("注册表并发写不丢条目（poison 根因回归）", () => {
  it.skipIf(!fs.existsSync(tsxBin))("两进程各写 40 条 → 全留存（无锁会丢约一半）", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-registry-race-"));
    const N = 40;
    const worker = path.join(root, "worker.ts");
    fs.writeFileSync(
      worker,
      `import { rememberWorkspace } from ${JSON.stringify(path.resolve(__dirname, "workspaceRegistry.ts"))};\n` +
        `const root = process.env.RR; const p = process.argv[2];\n` +
        `for (let i = 0; i < ${N}; i++) rememberWorkspace(root, { id: p + "-" + i, name: p + "-" + i, lastKnownRootPath: root });\n`,
    );
    const run = (prefix: string) =>
      new Promise<void>((resolve) =>
        spawn(tsxBin, [worker, prefix], { env: { ...process.env, RR: root }, stdio: "ignore" }).on("exit", () => resolve()),
      );
    await Promise.all([run("A"), run("B")]);
    const listed = new Set(listRecentWorkspaces(root).map((e) => e.id));
    let lost = 0;
    for (const p of ["A", "B"]) for (let i = 0; i < N; i++) if (!listed.has(`${p}-${i}`)) lost++;
    expect(lost).toBe(0);
  }, 30000);
});
