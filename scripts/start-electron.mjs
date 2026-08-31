import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installChildProcessLifecycle } from "./child-process-lifecycle.mjs";
import { ensureElectronSignature } from "./ensure-electron-signature.mjs";

const require = createRequire(import.meta.url);
const electron = require("electron");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Match `pnpm dev`: launching a revoked dev Electron lets XProtect delete the
// bundle, so repair its local signature before the first spawn.
ensureElectronSignature(electron, { log: (msg) => console.log(msg) });

// Auto-load the onboarding agent LLM (dm-fox gpt-5.5) from .secrets/agent.key so
// model onboarding works without manual `export`s. Already-set env vars win.
function loadOnboardingAgentEnv() {
  const out = {};
  let key = process.env.NOMI_ONBOARDING_AGENT_KEY || "";
  const keyPath = path.join(repoRoot, ".secrets", "agent.key");
  if (!key && fs.existsSync(keyPath)) {
    try { key = fs.readFileSync(keyPath, "utf8").trim(); } catch { /* ignore */ }
  }
  if (!key) return out;
  out.NOMI_ONBOARDING_AGENT_KEY = key;
  out.NOMI_ONBOARDING_AGENT_BASE_URL = process.env.NOMI_ONBOARDING_AGENT_BASE_URL || "https://dm-fox.rjj.cc/codex/v1";
  out.NOMI_ONBOARDING_AGENT_MODEL = process.env.NOMI_ONBOARDING_AGENT_MODEL || "gpt-5.5";
  out.NOMI_ONBOARDING_AGENT_PROVIDER = process.env.NOMI_ONBOARDING_AGENT_PROVIDER || "openai-compatible";
  return out;
}

const env = {
  ...process.env,
  ...loadOnboardingAgentEnv(),
  NOMI_LAUNCHER_PID: String(process.pid),
};
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.length > 2 ? process.argv.slice(2) : ["."];

const childProcessLifecycle = installChildProcessLifecycle();
const child = childProcessLifecycle.track(spawn(electron, args, {
  stdio: "inherit",
  shell: false,
  env,
}));

child.on("exit", (code, signal) => {
  if (childProcessLifecycle.isShuttingDown()) return;
  childProcessLifecycle.shutdown("SIGTERM", code ?? (signal ? 1 : 0));
});
