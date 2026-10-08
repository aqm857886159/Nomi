#!/usr/bin/env node

/**
 * Generate durable receipt samples with the writer from each release tag.
 *
 * The script extracts the historical module's local TypeScript dependency
 * graph with `git show`, then executes that release's service through tsx.
 * It intentionally writes only to the requested fixture directory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, "electron", "capabilityCore", "__fixtures__", "published-receipts");
const preJournalV2 = process.argv.includes("--pre-journal-v2");
const tags = process.argv.slice(2).filter((arg) => arg !== "--pre-journal-v2");
if (tags.length === 0) throw new Error("usage: pnpm exec tsx scripts/generate-published-receipt-fixtures.mjs <tag> [...tag]");

const binding = {
  projectId: "receipt-project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
};
const proposal = {
  proposalId: "proposal-a",
  summary: "created one shot",
  stepLabels: ["created Shot A"],
  categoryCounts: [{ categoryId: "shots", label: "Shots", count: 1 }],
  compensation: [
    { kind: "disconnect-edges", pairs: [{ source: "node-a", target: "node-b" }] },
    { kind: "delete-nodes", nodeIds: ["node-a"] },
  ],
  watchNodes: [{ nodeId: "node-a", title: "Shot A", prompt: "wide shot" }],
  reconciliationOk: false,
  anchorMessageId: "assistant-a",
  anchorTextOffset: 12,
};

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function resolveHistoricalPath(tag, sourcePath, importer, specifier, files) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts"), `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}/index.ts`];
  const found = candidates.find((candidate) => files.has(candidate));
  if (!found) throw new Error(`${tag}: cannot resolve ${specifier} from ${sourcePath}`);
  return found;
}

function extractHistoricalGraph(tag, destination) {
  const files = new Set(git("ls-tree", "-r", "--name-only", tag).split(/\r?\n/).filter(Boolean));
  const sourcePath = [
    "electron/capabilityCore/projectAgentProposalReceiptStore.ts",
    "electron/projectAgentHost/projectAgentProposalReceiptStore.ts",
  ].find((candidate) => files.has(candidate));
  if (!sourcePath) throw new Error(`${tag}: published receipt writer not found`);

  const pending = [sourcePath];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const source = git("show", `${tag}:${current}`);
    const target = path.join(destination, current);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source, "utf8");
    const importPattern = /(?:from\s+|import\(\s*)(["'])([^"']+)\1/g;
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveHistoricalPath(tag, current, current, match[2], files);
      if (resolved) pending.push(resolved);
    }
  }
  return path.join(destination, sourcePath);
}

async function generate(tag, workRoot) {
  const historicalRoot = path.join(workRoot, tag.replace(/[^a-zA-Z0-9.-]/g, "_"));
  const writerPath = extractHistoricalGraph(tag, historicalRoot);
  const RealDate = globalThis.Date;
  const FixedDate = class extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : ["2026-01-01T00:00:00.000Z"]));
    }
    static now() {
      return new RealDate("2026-01-01T00:00:00.000Z").getTime();
    }
  };
  globalThis.Date = FixedDate;
  const writer = await import(pathToFileURL(writerPath).href);
  const projectRoot = fs.mkdtempSync(path.join(workRoot, "project-"));
  fs.mkdirSync(path.join(projectRoot, ".nomi"), { recursive: true });
  const service = writer.createProjectAgentProposalReceiptService({ projectRoot, binding });
  const prepared = service.write({
    expectedRevision: 0,
    proposalId: proposal.proposalId,
    operationId: "prepare-proposal-a",
    lifecycle: "preparing",
    proposal,
  });
  service.write({
    expectedRevision: prepared.revision,
    proposalId: proposal.proposalId,
    operationId: "commit-proposal-a",
    lifecycle: "committed",
    proposal,
  });
  const receiptPath = path.join(projectRoot, ".nomi", "project-agent-proposal-receipt.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  globalThis.Date = RealDate;
  fs.rmSync(projectRoot, { recursive: true, force: true });
  return receipt;
}

// Keep the extracted graph below the repository so Node resolves this
// checkout's installed dependencies while executing historical TypeScript.
const workRoot = fs.mkdtempSync(path.join(repoRoot, ".tmp-published-receipt-generation-"));
fs.mkdirSync(outputDir, { recursive: true });
for (const tag of tags) {
  const receipt = await generate(tag, workRoot);
  if (preJournalV2 && tag === "v0.22.5") {
    delete receipt.proposalHash;
    delete receipt.operations;
    delete receipt.journalHash;
  }
  fs.writeFileSync(path.join(outputDir, `${tag}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`generated ${tag}\n`);
}
fs.rmSync(workRoot, { recursive: true, force: true });
