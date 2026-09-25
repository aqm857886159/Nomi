#!/usr/bin/env tsx
/**
 * Install an onboarded model into the live desktop catalog.json
 * without going through the Electron app.
 *
 * Reads trace.json from a lab trial dir, builds vendor + model + mapping
 * + apiKey records, and merges into:
 *   <real Nomi userData>/model-catalog.json   (location owned by tests/ux/_realProfile.mjs)
 *
 * API key is written as enc:"plain" — when the user opens the desktop
 * app, runtime.ts's readCatalog() lazy-upgrades to safeStorage.
 *
 * Usage:
 *   pnpm exec tsx scripts/lab-install-from-trial.ts \
 *     --trial docs/onboarding-trials/m5-install-kling3-... \
 *     --key  @.secrets/target.key
 */
import fs from "node:fs";
import path from "node:path";
import { realNomiProfile } from "../tests/ux/_realProfile.mjs";

type Args = { trial?: string; key?: string; dryRun?: boolean; label?: string };

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === "--trial") { out.trial = n; i++; }
    else if (a === "--key") { out.key = n; i++; }
    else if (a === "--label") { out.label = n; i++; }
    else if (a === "--dry-run") { out.dryRun = true; }
  }
  return out;
}

function readSecret(arg: string | undefined, env: string): string {
  if (!arg) return process.env[env] || "";
  if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8").trim();
  return arg;
}

function catalogPath(): string {
  return realNomiProfile().catalogPath;
}

function nowIso(): string {
  return new Date().toISOString();
}

function targetKindToBilling(kind: string): "text" | "image" | "video" | "audio" {
  if (kind === "text" || kind === "image" || kind === "video" || kind === "audio") return kind;
  throw new Error(`Unsupported kind '${kind}'`);
}

function targetKindToTaskKind(kind: string): string {
  if (kind === "text") return "chat";
  if (kind === "image") return "text_to_image";
  if (kind === "video") return "text_to_video";
  if (kind === "audio") return "text_to_audio";
  throw new Error(`Unsupported kind '${kind}'`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.trial) {
    console.error("--trial <dir> required");
    process.exit(1);
  }
  const userApiKey = readSecret(args.key, "TARGET_API_KEY");
  if (!userApiKey) {
    console.error("--key <value-or-@path> required (or TARGET_API_KEY env)");
    process.exit(1);
  }

  const tracePath = path.join(args.trial, "trace.json");
  if (!fs.existsSync(tracePath)) {
    console.error(`trace.json not found at ${tracePath}`);
    process.exit(1);
  }
  const trace = JSON.parse(fs.readFileSync(tracePath, "utf8")) as Array<Record<string, unknown>>;
  const trialEnd = trace.find((e) => e.type === "trial-end");
  if (!trialEnd) {
    console.error("No trial-end event in trace; trial may be incomplete");
    process.exit(1);
  }
  const outcome = trialEnd.outcome as Record<string, unknown>;
  const draft = outcome.draft as Record<string, unknown>;
  const status = String(outcome.status || "");

  if (status !== "success" && status !== "partial") {
    console.error(`Trial status '${status}' — won't install`);
    process.exit(1);
  }

  const vendorKey = String(draft.vendorKey || "").trim();
  const vendorName = String(draft.vendorName || vendorKey).trim();
  const vendorBaseUrl = String(draft.vendorBaseUrl || "").trim();
  const modelKey = String(draft.modelKey || "").trim();
  const modelDisplayName = String(args.label || draft.modelDisplayName || modelKey).trim();
  const targetKind = String(draft.targetKind || "").trim();
  const auth = (draft.vendorAuth as Record<string, unknown>) || {};
  const providerKind = String(draft.vendorProviderKind || "openai-compatible");

  const billingKind = targetKindToBilling(targetKind);
  const taskKind = targetKindToTaskKind(targetKind);

  const t = nowIso();

  const newVendor = {
    key: vendorKey,
    name: vendorName,
    enabled: true,
    baseUrlHint: vendorBaseUrl,
    authType: auth.type || "bearer",
    authHeader: auth.headerName || null,
    authQueryParam: auth.queryParam || null,
    providerKind,
    createdAt: t,
    updatedAt: t,
  };

  const newApiKey = {
    vendorKey,
    apiKey: userApiKey,
    enc: "plain" as const,
    enabled: true,
    createdAt: t,
    updatedAt: t,
  };

  const fields = Array.isArray(draft.modelFields) ? draft.modelFields as Array<Record<string, unknown>> : [];
  const newModel = {
    modelKey,
    vendorKey,
    modelAlias: modelKey,
    labelZh: modelDisplayName,
    kind: billingKind,
    enabled: true,
    onboarding: {
      addedVia: "agent",
      trialId: String(outcome.trialId || ""),
      docsUrl: String(outcome.docsUrl || ""),
      addedAt: t,
      fields: fields.map((f) => ({
        key: String(f.key),
        displayName: String(f.displayName),
        type: f.type,
        ...(f.options ? { options: f.options } : {}),
        ...(f.default !== undefined ? { default: String(f.default) } : {}),
        evidence: f.evidence,
      })),
    },
    createdAt: t,
    updatedAt: t,
  };

  const mappingCreate = draft.mappingCreate as Record<string, unknown> | undefined;
  const mappingQuery = draft.mappingQuery as Record<string, unknown> | undefined;

  const newMappings: Array<Record<string, unknown>> = [];
  if (mappingCreate) {
    newMappings.push({
      id: `mapping-${vendorKey}-${modelKey.replace(/[^a-zA-Z0-9-]/g, "-")}-create-${Date.now()}`,
      vendorKey,
      taskKind,
      name: `${modelDisplayName} (create)`,
      enabled: true,
      requestMapping: mappingCreate,
      responseMapping: mappingCreate.response_mapping || null,
      createdAt: t,
      updatedAt: t,
    });
  }
  if (mappingQuery) {
    newMappings.push({
      id: `mapping-${vendorKey}-${modelKey.replace(/[^a-zA-Z0-9-]/g, "-")}-query-${Date.now() + 1}`,
      vendorKey,
      taskKind,
      name: `${modelDisplayName} (query)`,
      enabled: true,
      requestMapping: mappingQuery,
      responseMapping: mappingQuery.response_mapping || null,
      createdAt: t,
      updatedAt: t,
    });
  }

  // Load + merge catalog
  const catPath = catalogPath();
  if (!fs.existsSync(catPath)) {
    console.error(`catalog not found at ${catPath} — launch the desktop app once to create it`);
    process.exit(1);
  }
  const catalog = JSON.parse(fs.readFileSync(catPath, "utf8")) as Record<string, unknown>;
  const oldVersion = catalog.version;
  catalog.version = 2;
  catalog.vendors = upsertBy("key", (catalog.vendors as unknown[]) || [], newVendor);
  catalog.models = upsertByPair("vendorKey", "modelKey", (catalog.models as unknown[]) || [], newModel);
  catalog.mappings = [...newMappings, ...((catalog.mappings as unknown[]) || [])];
  catalog.apiKeysByVendor = { ...(catalog.apiKeysByVendor as Record<string, unknown> || {}), [vendorKey]: newApiKey };

  console.log("");
  console.log(`▶ Installing ${modelDisplayName} (${modelKey})`);
  console.log(`  Vendor:      ${vendorKey} → ${vendorBaseUrl}`);
  console.log(`  Auth:        ${auth.type}`);
  console.log(`  Fields:      ${fields.length}`);
  console.log(`  Mappings:    ${newMappings.length}`);
  console.log(`  Catalog ver: ${oldVersion} → 2`);
  console.log(`  Target file: ${catPath}`);

  if (args.dryRun) {
    console.log("  (dry-run: not writing)");
    return;
  }

  // Backup before writing
  const backupPath = catPath + ".bak." + Date.now();
  fs.copyFileSync(catPath, backupPath);
  fs.writeFileSync(catPath, JSON.stringify(catalog, null, 2));
  console.log(`✓ Installed. (backup at ${backupPath})`);
}

function upsertBy(idKey: string, list: unknown[], item: Record<string, unknown>): unknown[] {
  const remaining = list.filter((e) => (e as Record<string, unknown>)[idKey] !== item[idKey]);
  return [item, ...remaining];
}

function upsertByPair(k1: string, k2: string, list: unknown[], item: Record<string, unknown>): unknown[] {
  const remaining = list.filter((e) => !((e as Record<string, unknown>)[k1] === item[k1] && (e as Record<string, unknown>)[k2] === item[k2]));
  return [item, ...remaining];
}

main();
