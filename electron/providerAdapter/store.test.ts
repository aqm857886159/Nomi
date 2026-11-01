import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CertificationMediaEvidence } from "./certificationMedia";
import type { ProviderAdapterRun } from "./types";
import {
  ProviderAdapterStore,
  connectionFingerprint,
  recoverableAdapterRuns,
} from "./store";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createStore(): { store: ProviderAdapterStore; filePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-provider-adapter-"));
  dirs.push(dir);
  const filePath = path.join(dir, "provider-adapters.json");
  return { store: new ProviderAdapterStore(filePath), filePath };
}

function run(overrides: Partial<ProviderAdapterRun> = {}): ProviderAdapterRun {
  return {
    id: "run-1",
    vendorKey: "example-com",
    vendorName: "Example",
    connectionFingerprint: "fingerprint",
    selectedModelKeys: ["paint-v2"],
    stage: "queued",
    repairAttempt: 0,
    models: [],
    sourceUrls: [],
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProviderAdapterStore", () => {
  it("persists an updated run atomically and reloads it", () => {
    const { store, filePath } = createStore();
    store.upsertRun(run());
    store.updateRun("run-1", (current) => ({ ...current, stage: "testing" }));

    const reloaded = new ProviderAdapterStore(filePath);
    expect(reloaded.getRun("run-1")?.stage).toBe("testing");
    expect(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("never stores a raw API key in the JSON file", () => {
    const { store, filePath } = createStore();
    const rawKey = "sk-super-secret-adapter-key";
    store.upsertRun(
      run({
        connectionFingerprint: connectionFingerprint({
          baseUrl: "https://api.example.com/v1",
          authType: "bearer",
          apiKey: rawKey,
          selectedModelKeys: ["paint-v2"],
        }),
      }),
    );

    expect(fs.readFileSync(filePath, "utf8")).not.toContain(rawKey);
  });

  it("persists only digest and allowlisted media metadata/reason params", () => {
    const { store, filePath } = createStore();
    store.upsertRun(run({
      models: [{
        modelKey: "paint-v2",
        labelZh: "Paint",
        kind: "image",
        modes: [{
          taskKind: "text_to_image",
          state: "verified",
          attempts: 1,
          mediaEvidence: [{
            kind: "image",
            contentType: "image/png",
            byteLength: 93,
            sha256: "a".repeat(64),
            metadata: { width: 2, height: 2, raw: "SECRET_BODY" } as never,
            url: "https://signed.invalid/a?token=SECRET",
            path: "/private/output.png",
          } as unknown as CertificationMediaEvidence],
          reasonCode: "media_mime_mismatch",
          errorParams: {
            declaredType: "image/png",
            detectedType: "image/jpeg",
            signedUrl: "https://signed.invalid/a?token=SECRET",
          } as never,
        }],
      }],
    }));

    const persisted = fs.readFileSync(filePath, "utf8");
    expect(persisted).toContain("a".repeat(64));
    expect(persisted).toMatch(/"width":\s*2/);
    expect(persisted).not.toMatch(/SECRET|signedUrl|\/private|"raw"|"url"|"path"/);
    expect(new ProviderAdapterStore(filePath).getRun("run-1")?.models[0].modes[0].mediaEvidence)
      .toEqual([{ kind: "image", contentType: "image/png", byteLength: 93, sha256: "a".repeat(64), metadata: { width: 2, height: 2 } }]);
  });

  // 运行时据 wireProtocol 换协议（vendorModelConnection），坏值读回时必须丢掉、照连接上的 providerKind 走。
  it("keeps only a valid text wire protocol on a persisted mode", () => {
    const { store, filePath } = createStore();
    const textRun = (id: string, wireProtocol: string) => run({ id, models: [{ modelKey: "text-v1", labelZh: "Text", kind: "text",
      modes: [{ taskKind: "chat", state: "verified", attempts: 1, wireProtocol: wireProtocol as never }] }] });
    store.upsertRun(textRun("run-ok", "openai-responses"));
    store.upsertRun(textRun("run-bad", "anthropic"));

    const reread = new ProviderAdapterStore(filePath);
    expect(reread.getRun("run-ok")?.models[0].modes[0].wireProtocol).toBe("openai-responses");
    expect(reread.getRun("run-bad")?.models[0].modes[0]).not.toHaveProperty("wireProtocol");
  });

  it("returns interrupted work for resume but excludes terminal runs", () => {
    const runs = [
      run({ id: "queued", stage: "queued" }),
      run({ id: "testing", stage: "testing" }),
      run({ id: "done", stage: "completed" }),
      run({ id: "partial", stage: "partial" }),
      run({ id: "failed", stage: "failed" }),
      run({ id: "cancelled", stage: "cancelled" }),
      run({ id: "timed-out", stage: "timed_out" }),
    ];

    expect(recoverableAdapterRuns(runs).map((item) => item.id)).toEqual(["queued", "testing"]);
  });

  it("lists recent runs with vendor and active filters", () => {
    const { store } = createStore();
    store.upsertRun(run({ id: "older", updatedAt: "2026-08-07T00:00:00.000Z" }));
    store.upsertRun(run({ id: "other", vendorKey: "other-com", updatedAt: "2026-08-07T02:00:00.000Z" }));
    store.upsertRun(run({ id: "newer", stage: "completed", updatedAt: "2026-08-07T03:00:00.000Z" }));

    expect(store.listRuns({ limit: 2 }).map((item) => item.id)).toEqual(["newer", "other"]);
    expect(store.listRuns({ vendorKey: "example-com" }).map((item) => item.id)).toEqual(["newer", "older"]);
    expect(store.listRuns({ activeOnly: true }).map((item) => item.id)).toEqual(["other", "older"]);
  });

  it("marks recoverable work stale when the connection fingerprint changed", () => {
    const { store } = createStore();
    store.upsertRun(run({ stage: "compiling" }));

    store.markStaleIfConnectionChanged("run-1", "different-fingerprint");

    expect(store.getRun("run-1")?.stage).toBe("stale");
  });
});

describe("connectionFingerprint", () => {
  it("normalizes model order but changes when credentials change", () => {
    const left = connectionFingerprint({
      baseUrl: "https://api.example.com/v1/",
      authType: "bearer",
      apiKey: "key-a",
      selectedModelKeys: ["video", "image"],
    });
    const same = connectionFingerprint({
      baseUrl: "https://api.example.com/v1",
      authType: "bearer",
      apiKey: "key-a",
      selectedModelKeys: ["image", "video"],
    });
    const changed = connectionFingerprint({
      baseUrl: "https://api.example.com/v1",
      authType: "bearer",
      apiKey: "key-b",
      selectedModelKeys: ["image", "video"],
    });

    expect(left).toBe(same);
    expect(left).not.toBe(changed);
  });
});
