#!/usr/bin/env tsx
/**
 * Lab CLI: run a single onboarding trial against a real model docs URL.
 *
 * Usage:
 *   pnpm run lab:onboard -- \
 *     --docs https://piapi.ai/docs/kling \
 *     --key xxx \
 *     --kind video \
 *     --agent-provider openai-compatible \
 *     --agent-base https://api.openai.com \
 *     --agent-model gpt-5 \
 *     --agent-key sk-...
 *
 * Or set env vars:
 *   AGENT_BASE_URL, AGENT_API_KEY, AGENT_MODEL_ID, AGENT_PROVIDER_KIND
 *
 * Output goes to docs/onboarding-trials/<timestamp>-<slug>/
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOnboardingTrial } from "../electron/ai/onboarding/agent";
import { createReporter } from "../electron/ai/onboarding/reporter";
import type { ModelKind, ProviderKind } from "../electron/ai/onboarding/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

type Args = {
  docs?: string;
  fixture?: string;
  key?: string;
  kind?: ModelKind;
  agentProvider?: ProviderKind;
  agentBase?: string;
  agentModel?: string;
  agentKey?: string;
  maxSteps?: number;
  trialId?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--docs": out.docs = next; i++; break;
      case "--fixture": out.fixture = next; i++; break;
      case "--key": out.key = next; i++; break;
      case "--kind": out.kind = next as ModelKind; i++; break;
      case "--agent-provider": out.agentProvider = next as ProviderKind; i++; break;
      case "--agent-base": out.agentBase = next; i++; break;
      case "--agent-model": out.agentModel = next; i++; break;
      case "--agent-key": out.agentKey = next; i++; break;
      case "--max-steps": out.maxSteps = Number(next); i++; break;
      case "--trial-id": out.trialId = next; i++; break;
    }
  }
  return out;
}

function readSecretArg(arg: string | undefined, envName: string): string {
  if (arg) {
    // support --key @path/to/file
    if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8").trim();
    return arg;
  }
  return process.env[envName] || "";
}

/**
 * Spin up a tiny localhost HTTP server serving HTML files from the fixtures dir.
 * Returns the base URL + a function to shut down the server.
 * Used by --fixture flag to feed malicious attack samples to the agent
 * without polluting the production hardenedFetch behavior.
 */
function startFixtureServer(fixturesDir: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const safePath = (req.url || "").replace(/\.\./g, "").replace(/^\/+/, "");
      const filePath = path.join(fixturesDir, safePath);
      // ensure resolved path is under fixturesDir
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(fixturesDir))) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }
      fs.readFile(resolved, (err, data) => {
        if (err) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("bad address"));
      resolve({ port: addr.port, close: () => server.close() });
    });
    server.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Set up docs URL — either user-provided or from a local fixture file
  let docsUrl = args.docs;
  let fixtureServer: { port: number; close: () => void } | null = null;
  if (args.fixture) {
    const fixturesDir = path.join(repoRoot, "docs", "onboarding-trials", "fixtures");
    const fixtureFile = args.fixture.endsWith(".html") ? args.fixture : `${args.fixture}.html`;
    const fullPath = path.join(fixturesDir, fixtureFile);
    if (!fs.existsSync(fullPath)) {
      console.error(`Fixture not found: ${fullPath}`);
      process.exit(1);
    }
    fixtureServer = await startFixtureServer(fixturesDir);
    docsUrl = `http://127.0.0.1:${fixtureServer.port}/${fixtureFile}`;
    // Name the exact fixture origin, never disable the private-host classifier. main.ts only
    // honours this on an unpackaged build; see electron/networkOutboundPolicy.ts.
    process.env.NOMI_LAB_TRUSTED_PRIVATE_ORIGINS = `http://127.0.0.1:${fixtureServer.port}`;
    console.log(`▶  Loaded fixture: ${fixtureFile} (served at ${docsUrl})`);
  }

  if (!docsUrl) {
    console.error("Missing --docs <url> or --fixture <name>");
    process.exit(1);
  }
  if (!args.kind) {
    console.error("Missing --kind <text|image|video|audio>");
    process.exit(1);
  }

  const userApiKey = readSecretArg(args.key, "TARGET_API_KEY");
  if (!userApiKey) {
    console.error("Missing target API key. Pass --key xxx or set TARGET_API_KEY env.");
    process.exit(1);
  }

  const agentApiKey = readSecretArg(args.agentKey, "AGENT_API_KEY");
  if (!agentApiKey) {
    console.error("Missing agent API key. Pass --agent-key xxx or set AGENT_API_KEY env.");
    process.exit(1);
  }

  const agentBaseUrl = args.agentBase || process.env.AGENT_BASE_URL || "https://api.openai.com";
  const agentModel = args.agentModel || process.env.AGENT_MODEL_ID || "gpt-4o";
  const agentProvider = (args.agentProvider || process.env.AGENT_PROVIDER_KIND || "openai-compatible") as ProviderKind;

  const trialId = args.trialId || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const trialsRoot = path.join(repoRoot, "docs", "onboarding-trials");

  const reporter = createReporter({
    trialsRoot,
    trialId,
    docsUrl,
    targetKind: args.kind,
  });

  console.log("");
  console.log(`▶  Trial: ${trialId}`);
  console.log(`   Docs:  ${docsUrl}`);
  console.log(`   Kind:  ${args.kind}`);
  console.log(`   Agent: ${agentModel} via ${agentBaseUrl}`);
  console.log(`   Out:   ${reporter.trialDir}`);
  console.log("");

  // simple live progress
  let lastTool = "";
  const wrappedOnEvent = (event: any) => {
    if (event.type === "tool-call") {
      lastTool = event.toolName;
      process.stdout.write(`   ◐ ${event.toolName} ... `);
    } else if (event.type === "tool-result") {
      const success = (event.result as any)?.ok !== false;
      process.stdout.write(`${success ? "✓" : "✗"}\n`);
    } else if (event.type === "llm-step") {
      // dim
    }
    reporter.onEvent(event);
  };

  try {
    const outcome = await runOnboardingTrial({
      trialId,
      docsUrl,
      targetKind: args.kind,
      userApiKey,
      agent: {
        providerKind: agentProvider,
        baseUrl: agentBaseUrl,
        modelId: agentModel,
        apiKey: agentApiKey,
      },
      maxSteps: args.maxSteps ?? 10,
      onEvent: wrappedOnEvent,
    });
    reporter.finalize(outcome);

    console.log("");
    console.log(`▶  Status: ${outcome.status.toUpperCase()}`);
    if (outcome.failureReason) console.log(`   Reason: ${outcome.failureReason}`);
    console.log(`   Time: ${(outcome.durationMs / 1000).toFixed(1)}s`);
    console.log(`   Tokens: ${outcome.tokenUsage.totalTokens.toLocaleString()}`);
    console.log(`   Fields extracted: ${outcome.draft.modelFields.length}`);
    console.log(`   Trace: ${reporter.trialDir}/trace.json`);
    console.log(`   Summary: ${reporter.trialDir}/summary.md`);
    console.log("");

    if (fixtureServer) fixtureServer.close();
    process.exit(outcome.status === "success" ? 0 : 1);
  } catch (e) {
    if (fixtureServer) fixtureServer.close();
    const msg = e instanceof Error ? e.message : String(e);
    console.error("");
    console.error(`✗  Trial crashed: ${msg}`);
    console.error("");
    process.exit(2);
  }
}

void main();
