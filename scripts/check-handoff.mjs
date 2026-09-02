#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HANDOFF_BASE = "origin/main";
export const ROLLBACK_SUSPICION_RATIO = 2;

function git(args, { cwd = REPO_ROOT, runGit = execFileSync } = {}) {
  return String(runGit("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

export function parseArgs(argv) {
  const withTests = argv.includes("--with-tests");
  const positional = argv.filter((value) => value !== "--with-tests" && value !== "--");
  if (positional.length !== 1 || !positional[0]) {
    throw new Error("Usage: pnpm run check:handoff -- <branch> [--with-tests]");
  }
  return { branch: positional[0], withTests };
}

export function deletedLinesFromNumstat(numstat) {
  return String(numstat || "").split(/\r?\n/).reduce((total, line) => {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+/);
    return total + (match && match[2] !== "-" ? Number(match[2]) : 0);
  }, 0);
}

export function summarizeDeletionRisk(twoPointDeleted, ownDeleted) {
  const ratio = ownDeleted === 0
    ? (twoPointDeleted === 0 ? 1 : Number.POSITIVE_INFINITY)
    : twoPointDeleted / ownDeleted;
  const suspicious = twoPointDeleted > 0 && (ownDeleted === 0 || ratio > ROLLBACK_SUSPICION_RATIO);
  return { twoPointDeleted, ownDeleted, ratio, suspicious };
}

export function countSuiteFailures(output, exitCode = 0) {
  const matches = [...String(output || "").matchAll(/system-test\s+[^:\n]+:\s+(PASS|FAIL)\s+\((\d+)\/(\d+)\s+stages passed\)/g)];
  if (matches.length > 0) {
    const last = matches.at(-1);
    const passed = Number(last[2]);
    const selected = Number(last[3]);
    return Math.max(0, selected - passed);
  }
  return exitCode === 0 ? 0 : 1;
}

export function inspectHandoff(branch, { cwd = REPO_ROOT, base = HANDOFF_BASE, runGit = execFileSync } = {}) {
  const resolvedBranch = git(["rev-parse", "--verify", `${branch}^{commit}`], { cwd, runGit });
  const resolvedBase = git(["rev-parse", "--verify", `${base}^{commit}`], { cwd, runGit });
  const mergeBase = git(["merge-base", resolvedBase, resolvedBranch], { cwd, runGit });
  const behind = Number(git(["rev-list", "--count", `${resolvedBranch}..${resolvedBase}`], { cwd, runGit }));
  const twoPointDeleted = deletedLinesFromNumstat(git(["diff", "--numstat", "--no-renames", resolvedBase, resolvedBranch], { cwd, runGit }));
  const ownDeleted = deletedLinesFromNumstat(git(["diff", "--numstat", "--no-renames", mergeBase, resolvedBranch], { cwd, runGit }));
  return {
    branch,
    resolvedBranch,
    base,
    resolvedBase,
    mergeBase,
    behind,
    deletionRisk: summarizeDeletionRisk(twoPointDeleted, ownDeleted),
  };
}

export function runFullSuite({ cwd = REPO_ROOT, runTests = spawnSync } = {}) {
  const result = runTests("pnpm", ["run", "test:system:full"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    command: "pnpm run test:system:full",
    exitCode: result.status ?? 1,
    failures: countSuiteFailures(output, result.status ?? 1),
  };
}

function formatRatio(ratio) {
  return Number.isFinite(ratio) ? ratio.toFixed(2) : "∞";
}

export function formatReport(report) {
  const risk = report.deletionRisk;
  const warning = risk.suspicious ? " ⚠ 回滚嫌疑" : "";
  const lines = [
    `check:handoff ${report.branch}`,
    `- 底座: ${report.base} behind ${report.behind} commit(s)`,
    `- 删除量: 两点 ${risk.twoPointDeleted} / 三点自身 ${risk.ownDeleted} = ${formatRatio(risk.ratio)}${warning}`,
  ];
  if (report.tests) lines.push(`- 全套件: ${report.tests.failures} failure(s) · exit ${report.tests.exitCode}`);
  return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    const options = parseArgs(argv);
    const report = inspectHandoff(options.branch, dependencies);
    if (options.withTests) report.tests = runFullSuite(dependencies);
    process.stdout.write(formatReport(report));
    return report.tests?.failures ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
