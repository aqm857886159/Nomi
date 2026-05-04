#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const defaultConfigPath = path.join(__dirname, "..", "..", "tapcanvas-api", "config.json");

function readConfig(configPath) {
  const p = path.resolve(process.cwd(), configPath || defaultConfigPath);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return {}; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next; i++;
  }
  return out;
}

const args = parseArgs(process.argv);
const config = readConfig(args.config);
const baseUrl = (args.baseUrl || config.apiBaseUrl || "http://localhost:8788").replace(/\/$/, "");
const apiKey = args.apiKey || config.apiKey || "";

if (!apiKey || apiKey === "REPLACE_WITH_YOUR_API_KEY") {
  console.error("ERROR: apiKey is required. Pass --apiKey or set it in tapcanvas-api/config.json");
  process.exit(1);
}

const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

async function apiFetch(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error(`ERROR ${res.status}: ${JSON.stringify(json)}`);
    process.exit(1);
  }
  return json;
}

const cmd = args.cmd || "health";

if (cmd === "health") {
  const r = await apiFetch("GET", "/model-catalog/health");
  console.log(JSON.stringify(r, null, 2));
}

else if (cmd === "list-vendors") {
  const r = await apiFetch("GET", "/model-catalog/vendors");
  console.log(JSON.stringify(r, null, 2));
}

else if (cmd === "list-models") {
  const qs = args.kind ? `?kind=${args.kind}` : "";
  const r = await apiFetch("GET", `/model-catalog/models${qs}`);
  console.log(JSON.stringify(r, null, 2));
}

else if (cmd === "list-mappings") {
  const qs = args.vendorKey ? `?vendorKey=${args.vendorKey}` : "";
  const r = await apiFetch("GET", `/model-catalog/mappings${qs}`);
  console.log(JSON.stringify(r, null, 2));
}

else if (cmd === "fetch-docs") {
  if (!args.url) { console.error("ERROR: --url required"); process.exit(1); }
  const r = await apiFetch("POST", "/model-catalog/docs/fetch", { url: args.url });
  console.log(JSON.stringify(r, null, 2));
}

else if (cmd === "import") {
  if (!args.pkg) { console.error("ERROR: --pkg (JSON string or file path) required"); process.exit(1); }
  let pkg;
  try {
    pkg = JSON.parse(args.pkg);
  } catch {
    pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args.pkg), "utf-8"));
  }
  const r = await apiFetch("POST", "/model-catalog/import", pkg);
  console.log(JSON.stringify(r, null, 2));
}

else if (cmd === "test-mapping") {
  if (!args.mappingId) { console.error("ERROR: --mappingId required"); process.exit(1); }
  const body = {
    modelKey: args.modelKey || "",
    prompt: args.prompt || "connection test",
    stage: args.stage || "create",
    execute: args.execute === "true",
  };
  const r = await apiFetch("POST", `/model-catalog/mappings/${args.mappingId}/test`, body);
  console.log(JSON.stringify(r, null, 2));
}

else {
  console.error(`Unknown cmd: ${cmd}. Available: health, list-vendors, list-models, list-mappings, fetch-docs, import, test-mapping`);
  process.exit(1);
}
