#!/usr/bin/env node
/**
 * Static, zero-cost certification coverage gate.
 *
 * This intentionally checks evidence references and declaration identity only;
 * it never imports credentials, calls a provider, or turns a simulation into a
 * live certification. The runtime/loopback/fault/MCP evidence is recorded by
 * the ledger and must be rerun when a mapping changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "docs/integration-certification/model-certification-ledger.json");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const errors = [];
const statuses = new Set(["documented", "simulated", "live-certified", "blocked"]);
const evidenceStatuses = new Set(["passed", "blocked", "not-run"]);
const read = (relative) => {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) {
    errors.push(`missing referenced file: ${relative}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
};
const readWithReexports = (relative, seen = new Set()) => {
  if (seen.has(relative)) return "";
  seen.add(relative);
  const source = read(relative);
  const imports = [...source.matchAll(/export\s+(?:\{[^}]*\}|\*|type\s+\{[^}]*\})\s+from\s+["'](\.\.?\/[^"']+)["']/g)];
  return source + imports.map((match) => {
    let target = path.normalize(path.join(path.dirname(relative), match[1])).replaceAll(path.sep, "/");
    if (!/\.[cm]?[jt]sx?$/.test(target)) target += ".ts";
    return readWithReexports(target, seen);
  }).join("\n");
};
const exists = (relative) => fs.existsSync(path.join(repoRoot, relative));
const urlOk = (value) => /^https:\/\//i.test(String(value || ""));
const forbiddenSecret = /(sk-[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{16,}|Key\s+[A-Za-z0-9._-]{16,})/;

if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length === 0) {
  errors.push("ledger must have schemaVersion=1 and a non-empty entries array");
}

const ids = new Set();
for (const entry of ledger.entries || []) {
  const label = entry?.id || "<unnamed>";
  if (ids.has(label)) errors.push(`${label}: duplicate ledger id`);
  ids.add(label);
  for (const key of ["vendorKey", "modelKey", "archetypeId", "modeId", "mappingId", "contractPath", "archetypePath", "status"]) {
    if (typeof entry?.[key] !== "string" || !entry[key].trim()) errors.push(`${label}: missing ${key}`);
  }
  if (!statuses.has(entry?.status)) errors.push(`${label}: unsupported status ${entry?.status}`);
  const contract = read(entry?.contractPath);
  const archetype = readWithReexports(entry?.archetypePath);
  const mappingIds = [entry.mappingId, ...(Array.isArray(entry.coveredMappingIds) ? entry.coveredMappingIds : [])].filter((value) => typeof value === "string" && value.trim());
  for (const mappingId of mappingIds) {
    const mappingPrefix = String(mappingId).replace(/(?:text_to_video|image_to_video|text_to_audio|image_to_audio|image_to_3d|text_to_image|image_edit|t2v|i2v|edit|music|sfx|reference|image)$/, "");
    if (contract && !contract.includes(mappingId) && !contract.includes(mappingPrefix) && !(entry.vendorKey === "fal" && contract.includes("FAL_OFFICIAL_ENDPOINT_COUNT"))) {
      errors.push(`${label}: mappingId ${mappingId} is not declared in ${entry.contractPath}`);
    }
  }
  if (archetype && !archetype.includes(`id: \"${entry.archetypeId}\"`) && !archetype.includes(`id: '${entry.archetypeId}'`)) {
    errors.push(`${label}: archetypeId ${entry.archetypeId} is not declared in ${entry.archetypePath}`);
  }
  if (!Array.isArray(entry.official) || entry.official.length === 0) errors.push(`${label}: official evidence is required`);
  for (const source of entry.official || []) {
    if (!urlOk(source.url) || !/^\d{4}-\d{2}-\d{2}$/.test(String(source.checkedAt || ""))) {
      errors.push(`${label}: official evidence requires https URL and checkedAt date`);
    }
  }
  for (const key of ["static", "loopback", "failureMatrix", "mcpDryRun"]) {
    if (!evidenceStatuses.has(entry?.evidence?.[key])) errors.push(`${label}: evidence.${key} must be passed, blocked, or not-run`);
  }
  if (entry.status === "blocked" && (!entry.live || typeof entry.live.blocker !== "string" || !entry.live.blocker.trim() || /not tested|未测试/i.test(entry.live.blocker))) {
    errors.push(`${label}: blocked entries require a precise blocker (not a generic not-tested message)`);
  }
  if (entry.status === "live-certified") {
    const live = entry.live || {};
    for (const key of ["productionReceipt", "managedArtifact", "freshProcessReadback"]) {
      if (typeof live[key] !== "string" || !live[key].trim()) errors.push(`${label}: live-certified requires live.${key}`);
    }
  }
  const serialized = JSON.stringify(entry);
  if (forbiddenSecret.test(serialized) || /api[_-]?key\s*[:=]\s*["'][^"']{12,}/i.test(serialized)) {
    errors.push(`${label}: ledger must not contain secrets`);
  }
}

const falEntries = (ledger.entries || []).filter((entry) => entry.vendorKey === "fal");
if (falEntries.length !== 17) errors.push(`fal coverage must contain 17 entries, found ${falEntries.length}`);
const falSource = read("electron/catalog/falOfficial.ts");
if (falSource && !/FAL_OFFICIAL_ENDPOINT_COUNT\s*=\s*[^;]+/.test(falSource)) errors.push("fal official source must export endpoint count");
const falCount = (falSource.match(/mapping\(/g) || []).length;
if (falSource && falCount < 17) errors.push(`fal official source declares fewer than 17 mappings (${falCount})`);

// Every literal curated mapping identity must appear in the ledger (directly or
// through coveredMappingIds). This catches the dangerous state where a model is
// visible in the catalog but has no certification record. Dynamic mapping tables
// (MiniMax) expose a checked-in identity manifest; the manifest is itself kept in
// sync with the runtime table by the catalog unit test.
const curatedContracts = [
  ["minimax", "electron/catalog/minimaxOfficial.ts"],
  ["elevenlabs", "electron/catalog/elevenlabs.ts"],
  ["runway", "electron/catalog/runwayOfficial.ts"],
  ["kie", "electron/catalog/kieGeminiOmni11.ts"],
  ["kie", "electron/catalog/kieSeedance.ts"],
];
for (const [vendorKey, contractPath] of curatedContracts) {
  const source = read(contractPath);
  const declared = new Set([...source.matchAll(/["'`](seed-[A-Za-z0-9_.-]+)["'`]/g)].map((match) => match[1]));
  const covered = new Set(
    (ledger.entries || [])
      .filter((entry) => entry.vendorKey === vendorKey)
      .flatMap((entry) => [entry.mappingId, ...(Array.isArray(entry.coveredMappingIds) ? entry.coveredMappingIds : [])]),
  );
  for (const mappingId of declared) {
    if (!covered.has(mappingId)) errors.push(`${vendorKey}: curated mapping ${mappingId} has no certification ledger entry`);
  }
}

for (const generated of [
  "electron/catalog/archetypeIdentifiers.generated.ts",
  "electron/catalog/archetypeModes.generated.ts",
  "electron/catalog/archetypeWireDefaults.audio.generated.ts",
  "electron/catalog/archetypeWireDefaults.video.generated.ts",
  "electron/catalog/archetypeWireDefaults.model3d.generated.ts",
]) if (!exists(generated)) errors.push(`generated archetype artifact missing: ${generated}`);

if (errors.length) {
  console.error("✖ model certification coverage gate failed");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✅ model certification coverage: ${ledger.entries.length} entries; fal=17; zero-cost evidence references are complete`);
