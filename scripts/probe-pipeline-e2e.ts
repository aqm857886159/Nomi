#!/usr/bin/env tsx
/**
 * Live end-to-end check of the SHARED request pipeline against the real kie API.
 * Builds the create + poll requests exactly the way production (runtime.ts) does
 * — same buildTemplateContext / buildHttpRequest / extractTaskId — using the
 * real catalog mapping and the real API key. No electron, no UI.
 *
 * Proves the unified pipeline actually creates a task, captures the upstream
 * task id (the 422 root cause), and polls recordInfo to a real asset URL.
 *
 * Never prints the API key.
 */
import fs from "node:fs";
import path from "node:path";
import {
  appendQueryParams,
  buildHttpRequest,
  buildTemplateContext,
  extractTaskId,
  looksLikeLogicalError,
} from "../electron/ai/requestPipeline";
import { realNomiProfile } from "../tests/ux/_realProfile.mjs";

const CATALOG = realNomiProfile().catalogPath;
const KEY_FILE = path.join(process.cwd(), ".secrets/target.key");

type Op = { method: string; path: string; headers?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; response_mapping?: Record<string, string> };

function followPath(root: unknown, expr: string): unknown {
  let cur: unknown = root;
  for (const part of expr.split(".").map((p) => p.trim()).filter(Boolean)) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}
function maybeParseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return v;
  try { return JSON.parse(t); } catch { return v; }
}

async function fire(op: Op, ctx: Record<string, unknown>, baseUrl: string, apiKey: string): Promise<unknown> {
  const built = buildHttpRequest({ baseUrl, authType: "bearer", apiKey, context: ctx, operation: op });
  const url = appendQueryParams(built.url, built.query);
  console.log(`  → ${built.method} ${built.url}`, JSON.stringify({ ...built.preview.headers }));
  const res = await fetch(url, {
    method: built.method,
    headers: built.headers,
    ...(built.method !== "GET" && built.body != null ? { body: JSON.stringify(built.body) } : {}),
  });
  const text = await res.text();
  let json: unknown; try { json = JSON.parse(text); } catch { json = text; }
  const logical = looksLikeLogicalError(json);
  console.log(`  ← HTTP ${res.status}${logical != null ? ` (logical ${logical})` : ""}`);
  if (!res.ok || logical != null) throw new Error(`request failed: ${text.slice(0, 300)}`);
  return json;
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const apiKey = fs.readFileSync(KEY_FILE, "utf8").trim();
  const mapping = catalog.mappings.find((m: { vendorKey: string; taskKind: string; enabled: boolean }) => m.vendorKey === "kie" && m.taskKind === "text_to_image" && m.enabled);
  const model = catalog.models.find((mo: { vendorKey: string; kind: string; enabled: boolean }) => mo.vendorKey === "kie" && mo.kind === "image" && mo.enabled);
  const baseUrl = catalog.vendors.find((v: { key: string }) => v.key === "kie").baseUrlHint;
  if (!mapping || !model) throw new Error("no enabled kie image mapping/model in catalog");
  console.log(`model=${model.modelKey}  base=${baseUrl}  key=<${apiKey.length} chars>`);

  // --- CREATE (same context shape production builds) ---
  const createCtx = buildTemplateContext({
    request: { prompt: "make the cat wear a tiny wizard hat" },
    params: {
      input_urls: ["https://raw.githubusercontent.com/EmbarkStudios/blender-tools/main/docs/cat.png"],
      aspect_ratio: "1:1",
    },
    model: {},
    modelKey: model.modelKey,
    apiKey,
  });
  console.log("\n[CREATE]");
  const createResp = await fire(mapping.create, createCtx, baseUrl, apiKey);

  const taskId = extractTaskId(createResp, mapping.create.response_mapping?.task_id);
  console.log(`  extractTaskId → "${taskId}"  ${taskId ? "✅" : "❌ (would poll a fake id → recordInfo is null)"}`);
  if (!taskId) throw new Error("no task id captured");

  // --- POLL (same providerMeta seeding production uses) ---
  console.log("\n[POLL recordInfo]");
  const sm: Record<string, string[]> = mapping.statusMapping || {};
  const classify = (state: string): string => {
    for (const [k, arr] of Object.entries(sm)) if (arr.map((s) => s.toLowerCase()).includes(state.toLowerCase())) return k;
    return state;
  };
  const queryCtx = buildTemplateContext({ request: {}, params: {}, model: {}, modelKey: model.modelKey, apiKey, providerMeta: { task_id: taskId, query_id: taskId } });

  for (let i = 1; i <= 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const resp = await fire(mapping.query, queryCtx, baseUrl, apiKey);
    const rm = mapping.query.response_mapping || {};
    const state = String(followPath(resp, rm.status || "data.state") ?? "");
    const status = classify(state);
    process.stdout.write(`  [${i}] state="${state}" → ${status}`);
    if (status === "succeeded") {
      const root = resp as Record<string, unknown>;
      const data = root.data as Record<string, unknown>;
      data.resultJson = maybeParseJson(data.resultJson);
      const url = followPath(resp, rm.image_url || "data.resultJson.resultUrls.0");
      console.log(`\n  ✅ DONE → ${url}`);
      return;
    }
    if (status === "failed") {
      console.log(`\n  ❌ FAILED → ${followPath(resp, rm.error_message || "data.failMsg")}`);
      return;
    }
    console.log("");
  }
  console.log("  ⏱ timed out after 40 polls");
}

void main().catch((e) => { console.error("\n✗", e instanceof Error ? e.message : e); process.exit(1); });
