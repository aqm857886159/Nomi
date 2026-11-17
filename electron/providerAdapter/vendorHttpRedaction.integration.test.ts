import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import { ProviderAdapterStore } from "./store";
import type { ProviderAdapterRun } from "./types";
import { verifyAdapterMode } from "./verifier";

const dirs: string[] = [];
const now = "2026-08-28T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("vendor HTTP exact redaction reaches adapter persistence", () => {
  // D-1117-delete-verification：格式检查不再发任何请求，所以「上游把 key 回显进错误、再漏进落盘 JSON」这条入口
  // 在结构上没了。这里钉住两件事：① 带着 key 跑格式检查，出站零次；② key 不进结果、run DTO、快照、落盘 JSON。
  it("keeps the credential out of verifier result, run DTO, store snapshot, and persisted JSON — and sends nothing", async () => {
    const secret = "opaqueCredentialValue987654";
    const vendor: Vendor = {
      key: "candidate",
      name: "Candidate",
      enabled: false,
      baseUrlHint: "https://candidate.example.test/v1",
      authType: "bearer",
      createdAt: now,
      updatedAt: now,
    };
    const model: Model = {
      vendorKey: vendor.key,
      modelKey: "image-v1",
      labelZh: "Image V1",
      kind: "image",
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };
    // 上游把 key 原样回显在错误里是真实见过的行为；假如有人再给格式检查接上网络，这个桩会把 key 回显回来。
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: `upstream echoed ${secret}` } }),
      { status: 401, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyAdapterMode({
      vendor,
      model,
      apiKey: secret,
      mode: {
        taskKind: "text_to_image",
        create: { method: "POST", path: "/images", body: { prompt: "{{request.prompt}}" }, response_mapping: { image_url: "data.0.url" } },
        testParams: {},
        sourceUrls: ["https://candidate.example.test/docs"],
      },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    if (!result.ok) throw new Error("expected the request format to be complete");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-redaction-"));
    dirs.push(dir);
    const filePath = path.join(dir, "provider-adapters.json");
    const store = new ProviderAdapterStore(filePath);
    const run: ProviderAdapterRun = {
      id: "run-redaction",
      vendorKey: vendor.key,
      lineageRootVendorKey: vendor.key,
      vendorName: vendor.name,
      connectionFingerprint: "non-secret-fingerprint",
      selectedModelKeys: [model.modelKey],
      stage: "completed",
      completedCount: 1,
      totalCount: 1,
      repairAttempt: 0,
      models: [{
        modelKey: model.modelKey,
        labelZh: model.labelZh,
        kind: model.kind,
        modes: [{
          taskKind: result.taskKind,
          state: "verified",
          attempts: 1,
          verifiedAt: now,
        }],
      }],
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    };

    const storedRun = store.upsertRun(run);
    expect(JSON.stringify({ storedRun, snapshot: store.snapshot() })).not.toContain(secret);
    expect(fs.readFileSync(filePath, "utf8")).not.toContain(secret);
  });
});
