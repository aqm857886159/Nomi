import path from "node:path";

function assertRunId(runId: string): string {
  const normalized = String(runId || "").trim();
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error("Invalid production run id");
  }
  return normalized;
}

export function productionRunsRoot(projectDir: string): string {
  return path.join(projectDir, ".nomi", "runs");
}

export function productionRunPaths(projectDir: string, runId: string) {
  const dir = path.join(productionRunsRoot(projectDir), assertRunId(runId));
  return {
    dir,
    snapshot: path.join(dir, "run.json"),
    events: path.join(dir, "events.ndjson"),
    commands: path.join(dir, "commands.ndjson"),
    approvals: path.join(dir, "approvals.ndjson"),
    budgetLedger: path.join(dir, "budget-ledger.ndjson"),
    jobsDir: path.join(dir, "jobs"),
  };
}
