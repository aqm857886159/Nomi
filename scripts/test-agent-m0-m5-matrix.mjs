import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIMENSIONS = ["happy", "boundary", "error", "timeout", "network"];
const MILESTONES = ["M0", "M1", "M2", "M3", "M4", "M5"];
const VALID_STATUSES = new Set(["ready", "blocked"]);
const MATRIX_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "system", "agent-m0-m5.json");

export function loadAgentMatrix(file = MATRIX_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function referencedFiles(command) {
  return command.args
    .filter((arg) => /^(?:electron|scripts|tests|src|docs)\//.test(arg))
    .filter((arg) => !arg.endsWith(".json") || arg.startsWith("tests/"));
}

export function validateAgentMatrix(matrix, { root }) {
  const errors = [];
  if (!matrix || matrix.schemaVersion !== 1) errors.push("matrix schemaVersion must be 1");
  if (matrix?.baseRef !== "origin/main") errors.push("matrix baseRef must be origin/main");
  if (JSON.stringify(matrix?.dimensions) !== JSON.stringify(DIMENSIONS)) errors.push("matrix dimensions must be H/B/E/T/N in stable order");
  if (!matrix?.commands || typeof matrix.commands !== "object") errors.push("matrix commands must be an object");
  const stages = Array.isArray(matrix?.stages) ? matrix.stages : [];
  if (stages.length !== MILESTONES.length) errors.push(`matrix must contain exactly ${MILESTONES.length} milestones`);
  const seen = new Set();

  for (const stage of stages) {
    if (!stage?.id || !stage?.milestone) {
      errors.push("stage must have id and milestone");
      continue;
    }
    if (seen.has(stage.id)) errors.push(`duplicate stage id: ${stage.id}`);
    seen.add(stage.id);
    if (!MILESTONES.includes(stage.milestone)) errors.push(`${stage.id}: unknown milestone ${stage.milestone}`);
    if (!stage.deliveryState) errors.push(`${stage.id}: missing deliveryState`);
    for (const dimension of DIMENSIONS) {
      const entry = stage.dimensions?.[dimension];
      if (!entry) {
        errors.push(`${stage.id}: missing ${dimension} entry`);
        continue;
      }
      if (!VALID_STATUSES.has(entry.status)) errors.push(`${stage.id}:${dimension}: status must be ready or blocked`);
      if (!Array.isArray(entry.assertions) && entry.status === "ready") errors.push(`${stage.id}:${dimension}: ready entry needs assertions`);
      if (entry.status === "ready") {
        if (!entry.commandRef || !matrix.commands?.[entry.commandRef]) errors.push(`${stage.id}:${dimension}: ready entry needs an existing commandRef`);
        if (!entry.assertions?.length) errors.push(`${stage.id}:${dimension}: ready entry needs at least one assertion`);
      } else if (!entry.reason || !entry.alternative) {
        errors.push(`${stage.id}:${dimension}: blocked entry needs reason and alternative evidence`);
      }
    }
    const persistence = stage.persistence;
    if (!persistence || typeof persistence.coldStart !== "boolean") errors.push(`${stage.id}: persistence needs coldStart boolean`);
    if (persistence?.status === "ready") {
      if (!persistence.commandRef || !matrix.commands?.[persistence.commandRef]) errors.push(`${stage.id}: ready persistence needs an existing commandRef`);
      if (!persistence.assertions?.length) errors.push(`${stage.id}: ready persistence needs assertions`);
    } else if (persistence?.status === "blocked" && (!persistence.reason || !persistence.alternative)) {
      errors.push(`${stage.id}: blocked persistence needs reason and alternative evidence`);
    }
  }

  for (const [ref, command] of Object.entries(matrix?.commands ?? {})) {
    if (!command.command || !Array.isArray(command.args) || !command.kind) errors.push(`${ref}: command needs kind, command, and args`);
    for (const file of referencedFiles(command)) {
      if (!fs.existsSync(path.join(root, file))) errors.push(`${ref}: missing referenced file ${file}`);
    }
    const serialized = JSON.stringify(command);
    if (/NOMI_AGENT_LIVE|APIMART_E2E=1|TIKHUB_E2E=1|DECONSTRUCT_E2E=1/.test(serialized)) {
      errors.push(`${ref}: live/provider credential or spend flags are forbidden in the default matrix`);
    }
  }

  const milestones = new Set(stages.map((stage) => stage.milestone));
  for (const milestone of MILESTONES) if (!milestones.has(milestone)) errors.push(`missing milestone ${milestone}`);
  return { errors, dimensions: DIMENSIONS, milestones: MILESTONES };
}

function resolveCommand(command) {
  return process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
}

function commandLabel(command) {
  return [command.command, ...command.args].join(" ");
}

function runCommand(root, runDir, ref, command, env) {
  const result = spawnSync(resolveCommand(command.command), command.args, {
    cwd: root,
    env: { ...env },
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === "win32" && command.command === "pnpm",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  fs.writeFileSync(path.join(runDir, `${ref}.stdout.log`), stdout);
  fs.writeFileSync(path.join(runDir, `${ref}.stderr.log`), stderr);
  return {
    ref,
    command: commandLabel(command),
    status: result.error?.code === "ETIMEDOUT" ? "timeout" : result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    stdout: path.join(runDir, `${ref}.stdout.log`),
    stderr: path.join(runDir, `${ref}.stderr.log`),
  };
}

function buildCommand() {
  return { kind: "matrix-build", command: "pnpm", args: ["run", "build"], boundaryMock: "none" };
}

function commandEvidence(result) {
  return result
    ? {
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal ?? null,
        error: result.error ?? null,
        stdout: result.stdout ?? null,
        stderr: result.stderr ?? null,
      }
    : { status: "not-run", exitCode: null, signal: null, error: "command result missing", stdout: null, stderr: null };
}

export function projectMatrixEvidence(stages, commandResults) {
  const resultsByRef = new Map(commandResults.map((result) => [result.ref, result]));
  const projectEntry = (entry) => {
    if (entry.status !== "ready") return entry;
    const result = resultsByRef.get(entry.commandRef);
    return { ...entry, status: result?.status ?? "not-run", result: commandEvidence(result) };
  };
  return stages.map((stage) => ({
    ...stage,
    dimensions: Object.fromEntries(Object.entries(stage.dimensions).map(([dimension, entry]) => [dimension, projectEntry(entry)])),
    persistence: projectEntry(stage.persistence),
  }));
}

function reportMarkdown(summary, stages, commandResults) {
  const lines = [
    "# Agent M0-M5 executable test matrix",
    "",
    `Result: **${summary.status.toUpperCase()}** · stages=${summary.stages} · dimensions=${summary.dimensions} · passed=${summary.passed} · blocked=${summary.blocked} · failed=${summary.failed}`,
    "",
    "| Stage | H | B | E | T | N | Persistence/cold-start |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const stage of stages) {
    const values = DIMENSIONS.map((dimension) => stage.dimensions[dimension].status).join(" | ");
    lines.push(`| ${stage.id} | ${values} | ${stage.persistence.status}/${stage.persistence.coldStart ? "cold-start" : "no-cold-start"} |`);
  }
  lines.push("", "## Executed commands", "", "| Ref | Status | Exit | Command |", "|---|---|---:|---|");
  for (const result of commandResults) lines.push(`| ${result.ref} | ${result.status} | ${result.exitCode} | \`${result.command}\` |`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function runAgentMatrix({ milestone, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), env = process.env, runDir } = {}) {
  const matrix = loadAgentMatrix();
  const validation = validateAgentMatrix(matrix, { root });
  if (validation.errors.length) throw new Error(`Invalid Agent M0-M5 matrix:\n${validation.errors.join("\n")}`);
  const selected = matrix.stages.filter((stage) => !milestone || stage.milestone === milestone);
  if (!selected.length) throw new Error(`Unknown or empty milestone selection: ${milestone}`);

  const outputDir = runDir ?? path.join(root, "tests", "system", "runs", `${new Date().toISOString().replaceAll(":", "-")}-agent-m0-m5${milestone ? `-${milestone}` : ""}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const refs = new Map();
  const blockedEvidence = [];
  for (const stage of selected) {
    for (const dimension of DIMENSIONS) {
      const entry = stage.dimensions[dimension];
      if (entry.status === "ready") refs.set(entry.commandRef, matrix.commands[entry.commandRef]);
      else blockedEvidence.push({ stage: stage.id, dimension, status: "blocked", reason: entry.reason, alternative: entry.alternative });
    }
    const persistence = stage.persistence;
    if (persistence.status === "ready") refs.set(persistence.commandRef, matrix.commands[persistence.commandRef]);
    else blockedEvidence.push({ stage: stage.id, dimension: "persistence", status: "blocked", reason: persistence.reason, alternative: persistence.alternative });
  }
  const commandResults = [];
  const needsBuild = [...refs.values()].some((command) => command.requiresBuild);
  if (needsBuild) {
    const buildResult = runCommand(root, outputDir, "prepare-build", buildCommand(), env);
    commandResults.push(buildResult);
    if (buildResult.status !== "passed") {
      for (const [ref, command] of refs) {
        commandResults.push({ ref, command: commandLabel(command), status: "failed", exitCode: buildResult.exitCode, signal: null, error: "required prepare-build failed", stdout: null, stderr: null });
      }
    }
  }
  if (!commandResults.some((result) => result.error === "required prepare-build failed")) {
    for (const [ref, command] of refs) commandResults.push(runCommand(root, outputDir, ref, command, env));
  }
  const commandResultByRef = new Map(commandResults.map((result) => [result.ref, result]));
  const failedRefs = new Set([...refs.keys()].filter((ref) => commandResultByRef.get(ref)?.status !== "passed"));
  const failed = selected.flatMap((stage) => [
    ...DIMENSIONS.filter((dimension) => stage.dimensions[dimension].status === "ready" && failedRefs.has(stage.dimensions[dimension].commandRef)).map((dimension) => ({ stage: stage.id, dimension, status: "failed", commandRef: stage.dimensions[dimension].commandRef })),
    ...(stage.persistence.status === "ready" && failedRefs.has(stage.persistence.commandRef) ? [{ stage: stage.id, dimension: "persistence", status: "failed", commandRef: stage.persistence.commandRef }] : []),
  ]);
  const passed = selected.reduce((count, stage) => count + DIMENSIONS.filter((dimension) => stage.dimensions[dimension].status === "ready" && !failedRefs.has(stage.dimensions[dimension].commandRef)).length + (stage.persistence.status === "ready" && !failedRefs.has(stage.persistence.commandRef) ? 1 : 0), 0);
  const summary = {
    status: failed.length ? "failed" : blockedEvidence.length ? "blocked" : "passed",
    stages: selected.length,
    dimensions: selected.length * (DIMENSIONS.length + 1),
    passed,
    blocked: blockedEvidence.length,
    failed: failed.length,
    ok: failed.length === 0 && blockedEvidence.length === 0,
  };
  const evidencedStages = projectMatrixEvidence(selected, commandResults);
  const receipt = {
    schemaVersion: 1,
    matrixFile: path.relative(root, MATRIX_FILE),
    milestone: milestone ?? "all",
    summary,
    stages: evidencedStages,
    blockedEvidence,
    failedEvidence: failed,
    commandResults,
  };
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(receipt, null, 2));
  fs.writeFileSync(path.join(outputDir, "report.md"), reportMarkdown(summary, evidencedStages, commandResults));
  return { ...receipt, runDir: outputDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const checkOnly = process.argv.includes("--check");
    const milestoneArg = process.argv.find((arg) => MILESTONES.includes(arg));
    const matrix = loadAgentMatrix();
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const validation = validateAgentMatrix(matrix, { root });
    if (validation.errors.length) {
      console.error(validation.errors.join("\n"));
      process.exit(1);
    }
    if (checkOnly) {
      console.log(`AGENT MATRIX CHECK PASS: ${MILESTONES.join("/")} H/B/E/T/N schema and command references`);
      process.exit(0);
    }
    const result = runAgentMatrix({ milestone: milestoneArg, root });
    console.log(`AGENT MATRIX ${result.summary.status.toUpperCase()}: ${result.summary.passed} passed, ${result.summary.blocked} blocked, ${result.summary.failed} failed`);
    console.log(`receipt: ${path.relative(root, result.runDir)}/summary.json`);
    process.exit(result.summary.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}
