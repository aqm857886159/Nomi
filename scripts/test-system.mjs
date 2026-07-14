import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROFILES, STAGES } from "../tests/system/profiles.mjs";

export function expandProfile(name) {
  const ids = PROFILES[name];
  if (!ids) throw new Error(`unknown test profile: ${name}`);
  return ids.map((id) => ({ ...STAGES[id] }));
}

export function summarizeStages(stages) {
  const passed = stages.filter((stage) => stage.status === "passed").length;
  const failed = stages.filter((stage) => stage.status === "failed").length;
  const skipped = stages.filter((stage) => stage.status === "skipped").length;
  const unsupported = stages.filter((stage) => stage.status === "unsupported").length;
  return { discovered: stages.length, selected: stages.length, passed, failed, skipped, unsupported, ok: failed === 0 && stages.every((stage) => !stage.required || stage.status === "passed") };
}

function reportMarkdown(profile, summary, stages) {
  const rows = stages.map((stage) => `| ${stage.id} | ${stage.status} | ${stage.exitCode ?? "—"} | ${stage.durationMs} |`);
  return [`# Nomi system test: ${profile}`, "", `Result: **${summary.ok ? "PASS" : "FAIL"}** · ${summary.passed}/${summary.selected} stages passed`, "", "| Stage | Status | Exit | Duration ms |", "|---|---|---:|---:|", ...rows, ""].join("\n");
}

export function runProfile(profile, { root = path.resolve(import.meta.dirname, ".."), env = process.env } = {}) {
  const stages = expandProfile(profile);
  for (const stage of stages) {
    const started = Date.now();
    const result = spawnSync(stage.command, stage.args, { cwd: root, env, stdio: "inherit" });
    stage.durationMs = Date.now() - started;
    stage.exitCode = result.status ?? 1;
    stage.status = stage.exitCode === 0 ? "passed" : "failed";
    if (stage.status === "failed") break;
  }
  for (const stage of stages) if (!stage.status) stage.status = "skipped";
  const summary = summarizeStages(stages);
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const runDir = path.join(root, "tests/system/runs", `${stamp}-${profile}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ profile, summary, stages }, null, 2));
  fs.writeFileSync(path.join(runDir, "report.md"), reportMarkdown(profile, summary, stages));
  return { profile, summary, stages, runDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = runProfile(process.argv[2] || "quick");
    console.log(`system-test ${result.profile}: ${result.summary.ok ? "PASS" : "FAIL"} (${result.summary.passed}/${result.summary.selected})`);
    console.log(`report: ${path.relative(process.cwd(), result.runDir)}/report.md`);
    process.exit(result.summary.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
