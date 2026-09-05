// check-push-bypass.node-test.mjs
// 回归测试：验证 check:push-bypass 门岗的核心判定逻辑。
//
// 测试的不变量：
//   1. 日志不存在 → 直接通过（exit 0）
//   2. 所有行 confirmed=yes → 通过
//   3. 有 confirmed=no 且无对应 gates 戳 → 报红（exit 1）
//   4. --accept <sha> 把 confirmed=no 改为 confirmed=yes
//   5. --clear-confirmed 删除已确认的行
//   6. 有 gates 戳的绕口自动确认（不报红）
//
// 隔离方式：通过 NOMI_BYPASS_LOG_OVERRIDE 指向临时目录，不污染真实仓库的 .claude/push-bypass.log

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-push-bypass.mjs"
);

function runGate(args, bypassLogPath) {
  const env = { ...process.env }
  if (bypassLogPath != null) {
    env.NOMI_BYPASS_LOG_OVERRIDE = bypassLogPath
  }
  const result = spawnSync("node", [scriptPath, ...args], {
    env,
    encoding: "utf8",
  });
  return { exit: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function makeLogDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bypass-test-"))
  const logPath = path.join(dir, "push-bypass.log")
  return { dir, logPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test("no bypass log → pass (exit 0)", () => {
  const { dir, logPath, cleanup } = makeLogDir()
  try {
    // 日志文件不存在
    const { exit } = runGate([], logPath);
    assert.equal(exit, 0);
  } finally {
    cleanup()
  }
});

test("all confirmed=yes → pass (exit 0)", () => {
  const { dir, logPath, cleanup } = makeLogDir()
  try {
    fs.writeFileSync(
      logPath,
      "2026-09-03T00:00:00Z|bypass|branch=main|sha=abc123|worktree=/tmp/x|cmd=git push|confirmed=yes\n"
    );
    const { exit } = runGate([], logPath);
    assert.equal(exit, 0);
  } finally {
    cleanup()
  }
});

test("confirmed=no without gates stamp → fail (exit 1)", () => {
  const { dir, logPath, cleanup } = makeLogDir()
  try {
    fs.writeFileSync(
      logPath,
      "2026-09-03T00:00:00Z|bypass|branch=feat/x|sha=deadbeef1234|worktree=/tmp/nonexistent-wt-12345|cmd=git -c core.hooksPath=/dev/null push|confirmed=no\n"
    );
    const { exit, stderr } = runGate([], logPath);
    assert.equal(exit, 1, `expected exit 1, got ${exit}\nstderr: ${stderr}`);
    assert.ok(
      stderr.includes("deadbeef1234") || stderr.includes("push 绕口"),
      `stderr should mention sha or bypass: ${stderr}`
    );
  } finally {
    cleanup()
  }
});

test("--accept <sha> marks confirmed=no as confirmed=yes → then passes", () => {
  const { dir, logPath, cleanup } = makeLogDir()
  try {
    const sha = "aabbcc112233";
    fs.writeFileSync(
      logPath,
      `2026-09-03T00:00:00Z|bypass|branch=feat/y|sha=${sha}|worktree=/tmp/nonexistent-wt-12345|cmd=git --no-verify push|confirmed=no\n`
    );

    // 先报红
    const before = runGate([], logPath);
    assert.equal(before.exit, 1, `before --accept should fail: ${before.stderr}`);

    // --accept 标记
    const accept = runGate(["--accept", sha], logPath);
    assert.equal(accept.exit, 0, `--accept should exit 0: ${accept.stderr}`);

    // 再次运行应当通过
    const after = runGate([], logPath);
    assert.equal(after.exit, 0, `after --accept should pass: ${after.stderr}`);

    // 验证日志文件内容已改为 confirmed=yes
    const content = fs.readFileSync(logPath, "utf8");
    assert.ok(content.includes("confirmed=yes"), `log should contain confirmed=yes: ${content}`);
  } finally {
    cleanup()
  }
});

test("--clear-confirmed removes confirmed=yes lines → passes (empty log)", () => {
  const { dir, logPath, cleanup } = makeLogDir()
  try {
    fs.writeFileSync(
      logPath,
      [
        "2026-09-03T00:00:00Z|bypass|branch=feat/a|sha=sha1a|worktree=/tmp/x|cmd=...|confirmed=yes",
        "2026-09-03T00:00:01Z|bypass|branch=feat/b|sha=sha2b|worktree=/tmp/x|cmd=...|confirmed=yes",
      ].join("\n") + "\n"
    );

    const { exit } = runGate(["--clear-confirmed"], logPath);
    assert.equal(exit, 0, `--clear-confirmed should pass: ${exit}`);

    // 日志应为空（全部是 confirmed=yes，清完后没有行了）
    const content = fs.readFileSync(logPath, "utf8");
    assert.equal(content.trim(), "", `log should be empty after clear: '${content}'`);
  } finally {
    cleanup()
  }
});

test("gates stamp present with matching sha → auto-confirm and pass", () => {
  // 构建一个临时 git repo，在其 .git/nomi-gates-ok 里写入 sha
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bypass-wt-"));
  const { dir, logPath, cleanup } = makeLogDir()
  try {
    // 初始化一个临时 git repo
    execFileSync("git", ["init", "--quiet"], { cwd: worktreeDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], { cwd: worktreeDir });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreeDir, encoding: "utf8" }).trim();

    // 写入 gates 戳
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: worktreeDir, encoding: "utf8" }).trim();
    fs.writeFileSync(path.join(gitDir, "nomi-gates-ok"), `sha=${sha}\ntimestamp=2026-09-03T00:00:00Z\n`);

    // bypass 日志指向该 worktree 和 sha
    fs.writeFileSync(
      logPath,
      `2026-09-03T00:00:00Z|bypass|branch=feat/z|sha=${sha}|worktree=${worktreeDir}|cmd=git -c core.hooksPath=/dev/null push|confirmed=no\n`
    );

    const { exit } = runGate([], logPath);
    assert.equal(exit, 0, `matching gates stamp should auto-confirm and pass: exit=${exit}`);
  } finally {
    cleanup()
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
});
