#!/usr/bin/env tsx
/**
 * Add a text/chat model + its OpenAI-compatible vendor + apiKey to the
 * live Nomi catalog.json. Used to configure the "AI agent" + "AI 写文章"
 * paths without going through the wizard.
 *
 * No mapping needed — AI SDK handles /chat/completions for providerKind
 * "openai-compatible".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function catalogPath(): string {
  return path.join(os.homedir(), "Library", "Application Support", "nomi", "model-catalog.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function readSecret(arg: string): string {
  if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8").trim();
  return arg;
}

type Args = {
  vendorKey: string;
  vendorName: string;
  baseUrl: string;
  modelKey: string;
  displayName: string;
  apiKey: string;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : "";
  };
  return {
    vendorKey: get("--vendor-key"),
    vendorName: get("--vendor-name") || get("--vendor-key"),
    baseUrl: get("--base-url"),
    modelKey: get("--model-key"),
    displayName: get("--display-name") || get("--model-key"),
    apiKey: readSecret(get("--api-key")),
  };
}

const args = parseArgs(process.argv.slice(2));
for (const k of ["vendorKey", "baseUrl", "modelKey", "apiKey"] as const) {
  if (!args[k]) {
    console.error(`Missing --${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`);
    process.exit(1);
  }
}

const t = nowIso();
const file = catalogPath();
if (!fs.existsSync(file)) {
  console.error(`catalog not found at ${file} — launch Nomi once first`);
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
const backup = file + ".bak." + Date.now();
fs.copyFileSync(file, backup);

// 1. vendor
const newVendor = {
  key: args.vendorKey,
  name: args.vendorName,
  enabled: true,
  baseUrlHint: args.baseUrl.replace(/\/+$/, ""),
  authType: "bearer",
  authHeader: null,
  authQueryParam: null,
  providerKind: "openai-compatible",
  createdAt: t,
  updatedAt: t,
};
const vendors = (catalog.vendors as Array<Record<string, unknown>>) || [];
catalog.vendors = [newVendor, ...vendors.filter((v) => v.key !== args.vendorKey)];

// 2. apiKey
const apiKeys = (catalog.apiKeysByVendor as Record<string, unknown>) || {};
apiKeys[args.vendorKey] = {
  vendorKey: args.vendorKey,
  apiKey: args.apiKey,
  enc: "plain", // will be lazy-upgraded to safeStorage on first desktop read
  enabled: true,
  createdAt: t,
  updatedAt: t,
};
catalog.apiKeysByVendor = apiKeys;

// 3. text model
const newModel = {
  modelKey: args.modelKey,
  vendorKey: args.vendorKey,
  modelAlias: args.modelKey,
  labelZh: args.displayName,
  kind: "text" as const,
  enabled: true,
  createdAt: t,
  updatedAt: t,
};
const models = (catalog.models as Array<Record<string, unknown>>) || [];
catalog.models = [
  newModel,
  ...models.filter((m) => !(m.vendorKey === args.vendorKey && m.modelKey === args.modelKey)),
];

// 4. ensure version v2
catalog.version = 2;

fs.writeFileSync(file, JSON.stringify(catalog, null, 2));

console.log("");
console.log(`▶ Installed text model into catalog:`);
console.log(`  Vendor:     ${args.vendorKey} → ${args.baseUrl}`);
console.log(`  Model:      ${args.modelKey} (text)`);
console.log(`  Display:    ${args.displayName}`);
console.log(`  Provider:   openai-compatible`);
console.log(`  Backup:     ${backup}`);
console.log("");
console.log(`✓ Restart Nomi to pick up changes.`);
