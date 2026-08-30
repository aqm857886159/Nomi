import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../vendor/vendorHttp";
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
  it("keeps an opaque upstream credential out of verifier result, run DTO, store snapshot, and persisted JSON", async () => {
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ message: `upstream echoed ${secret}` }),
      { status: 500 },
    )));

    const result = await verifyAdapterMode({
      vendor,
      model,
      apiKey: secret,
      mode: {
        taskKind: "text_to_image",
        create: { method: "POST", path: "/images", body: { prompt: "{{request.prompt}}" } },
        testParams: {},
        sourceUrls: ["https://candidate.example.test/docs"],
      },
    }, {
      execute: async () => ({
        response: await requestJson(
          vendor,
          secret,
          "POST",
          "https://candidate.example.test/v1/images",
          { Authorization: `Bearer ${secret}` },
          {},
          {},
        ),
        request: {},
      }),
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    if (result.ok) throw new Error("expected verification failure");

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
      stage: "failed",
      completedCount: 1,
      totalCount: 1,
      repairAttempt: 0,
      models: [{
        modelKey: model.modelKey,
        labelZh: model.labelZh,
        kind: model.kind,
        modes: [{
          taskKind: result.taskKind,
          state: "failed",
          attempts: 1,
          stage: result.stage,
          error: result.error,
          ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
          ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
        }],
      }],
      sourceUrls: [],
      error: result.error,
      createdAt: now,
      updatedAt: now,
    };

    const storedRun = store.upsertRun(run);
    expect(JSON.stringify({ storedRun, snapshot: store.snapshot() })).not.toContain(secret);
    expect(fs.readFileSync(filePath, "utf8")).not.toContain(secret);
  });
});
