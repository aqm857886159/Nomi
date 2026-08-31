import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalAssetMediaBytes } from "./assetLocalization";
import { resolveTaskStatus } from "../tasks/responseParsing";
import { ensureAsyncMediaOutput } from "../tasks/taskResultQuery";
import { VendorRequestError, categorizeVendorFailure, requestJson } from "../vendor/vendorHttp";
import type { TaskResult } from "../runtime";
import type { Vendor } from "./types";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-fal-fault-matrix", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
}));

const vendor = { key: "fal", authType: "bearer", baseUrlHint: "https://queue.fal.run" } as Vendor;

afterEach(() => vi.unstubAllGlobals());

describe("fal zero-cost fault matrix", () => {
  it.each([
    [401, "auth", false],
    [402, "balance", false],
    [429, "quota", true],
    [500, "server", true],
    [502, "server", true],
    [400, "input", false],
    [422, "input", false],
  ] as const)("classifies HTTP %s as %s (retry=%s)", (status, category, retryable) => {
    expect(categorizeVendorFailure(status)).toEqual({ category, retryable });
  });

  it.each([
    ["IN_QUEUE", "queued"],
    ["IN_PROGRESS", "running"],
    ["COMPLETED", "succeeded"],
    ["FAILED", "failed"],
    ["CANCELED", "failed"],
  ] as const)("maps fal status %s to %s", (raw, expected) => {
    expect(resolveTaskStatus({ status: raw }, { status: "status" }, {
      queued: ["IN_QUEUE"], running: ["IN_PROGRESS"], succeeded: ["COMPLETED"], failed: ["FAILED", "CANCELED", "CANCELLED"],
    }, []).status).toBe(expected);
  });

  it("does not turn an unknown fal status into a false success", () => {
    expect(resolveTaskStatus({ status: "PAUSED_BY_PROVIDER" }, { status: "status" }, {
      queued: ["IN_QUEUE"], running: ["IN_PROGRESS"], succeeded: ["COMPLETED"], failed: ["FAILED", "CANCELED"],
    }, [])).toEqual({ status: "queued", unrecognizedStatus: "PAUSED_BY_PROVIDER" });
  });

  it("turns COMPLETED with no media into a terminal failure", () => {
    const completed: TaskResult = { id: "fal-result", kind: "text_to_video", status: "succeeded", assets: [], raw: { status: "COMPLETED" } };
    expect(ensureAsyncMediaOutput(completed, "video")).toMatchObject({ status: "failed", error: expect.stringMatching(/output|产物/) });
  });

  it("treats malformed JSON as an untrusted non-success payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{ definitely-not-json", { status: 200, headers: { "content-type": "application/json" } })));
    const response = await requestJson(vendor, "test-key", "GET", "https://queue.fal.run/fal/test", {}, {}, null);
    expect(typeof response).toBe("string");
    expect(resolveTaskStatus(response, { status: "status" }, { queued: ["IN_QUEUE"], running: ["IN_PROGRESS"], succeeded: ["COMPLETED"], failed: ["FAILED"] }, [])).toMatchObject({ status: "queued", unrecognizedStatus: "{ definitely-not-json" });
  });

  it("fails closed on an oversized result body without exposing payload bytes", async () => {
    const sentinel = "FAL_EPHEMERAL_URL_SECRET";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`{"output":"${sentinel}${"x".repeat(200)}"}`, { status: 200 })));
    const error = await requestJson(vendor, "test-key", "GET", "https://queue.fal.run/fal/test", {}, {}, null, undefined, { maxResponseBytes: 32 }).catch((value) => value);
    expect(error).toBeInstanceOf(VendorRequestError);
    expect((error as VendorRequestError).structured).toMatchObject({ category: "network", retryable: false });
    expect(JSON.stringify((error as VendorRequestError).structured)).not.toContain(sentinel);
  });

  it("rejects a MIME/magic mismatch before any fal upload or generation call", () => {
    expect(() => assertLocalAssetMediaBytes({ bytes: Buffer.from("not-a-png"), contentType: "image/png", fileName: "ref.png" })).toThrow(/真实文件头|未知\/损坏/);
  });
});
