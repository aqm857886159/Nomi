import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "./types";
import { NEWAPI_IMAGE_CREATE_OP, NEWAPI_VIDEO_CREATE_OP, OPENAI_MULTIPART_IMAGE_EDIT_OP } from "./newapiTransport";
import { buildProfileHttpRequest } from "./profileHttpRequest";

let userDataRoot = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const localReference = "nomi-local://adapter-test/reference.png";
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const vendor: Vendor = {
  key: "onboarding-fixture", name: "Fixture", enabled: true,
  baseUrlHint: "https://provider.example/v1", authType: "bearer",
  // If multipart regresses into URL ingestion, the test must reject that network call.
  assetIngestion: { strategy: "upload-multipart", endpoint: "https://upload.example/files", urlPath: "url", accepts: ["image"] },
  createdAt: "now", updatedAt: "now",
};
const model: Model = {
  vendorKey: vendor.key, modelKey: "gpt-image-2", labelZh: "GPT Image 2", kind: "image",
  enabled: true, createdAt: "now", updatedAt: "now",
};

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-onboarding-contract-"));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

describe.each(["text_to_video", "image_to_video"] as const)("persisted %s mappings", (kind) => {
  it.each([
    ["16:9", "1024x576"], ["9:16", "576x1024"], ["3:1", "1024x336"],
    ["1:3", "336x1024"], ["2048:815", "1024x416"],
  ])("preserves %s video dimensions", async (ratio, size) => {
    // Old video mappings persist this same transform ID; no image-only limit may leak into them.
    const operation = JSON.parse(JSON.stringify(NEWAPI_VIDEO_CREATE_OP));
    const built = buildProfileHttpRequest({
      vendor, model: { ...model, modelKey: "video-fixture", kind: "video" }, apiKey: "test-key", operation,
      request: { kind, prompt: "a blue paper square", extras: { aspect_ratio: ratio, resolution: "1K", taskKind: "text_to_image" } },
    });
    expect(built.body).toMatchObject({ size });
  });
});

describe.each([
  ["text_to_image", NEWAPI_IMAGE_CREATE_OP],
  ["image_edit", OPENAI_MULTIPART_IMAGE_EDIT_OP],
] as const)("provider onboarding: %s at the runtime request boundary", (kind, operation) => {
  async function dispatch(extras: Record<string, unknown>) {
    let body: Record<string, unknown> | FormData | undefined;
    const endpoint = `https://provider.example${operation.path}`;
    const fetchFn = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe(endpoint);
      expect(init?.method).toBe("POST");
      body = init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ url: "https://provider.example/result.png" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchFn);
    const reader = vi.fn((url: string) => url === localReference
      ? { bytes, contentType: "image/png", fileName: "reference.png" } : null);
    const { executeProfileOperation } = await import("../runtime");
    await executeProfileOperation({
      vendor, model, apiKey: "test-key", stage: "create", operation, localAssetReader: reader,
      request: { kind, prompt: "a blue paper square", extras: {
        ...extras, ...(kind === "image_edit" ? { referenceImages: [localReference] } : {}),
      } },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    if (kind === "image_edit") {
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get("model")).toBe("gpt-image-2");
      const files = form.getAll("image[]") as File[];
      expect(files).toHaveLength(1);
      expect(Buffer.from(await files[0].arrayBuffer())).toEqual(bytes);
      expect(reader).toHaveBeenCalledWith(localReference);
      return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
    }
    expect(body).not.toBeInstanceOf(FormData);
    expect(body).toMatchObject({ model: "gpt-image-2" });
    expect(reader).not.toHaveBeenCalled();
    return body as Record<string, unknown>;
  }

  it.each([undefined, "", "   "])("Auto / 1K omits saved size %j", async (size) => {
    const body = await dispatch({ aspect_ratio: "auto", resolution: "1K", size });
    expect(body).not.toHaveProperty("size");
  });

  it.each(["16:9", "9:16", "3:1", "1:3"])("%s / 1K is a legal wire size", async (ratio) => {
    const body = await dispatch({ aspect_ratio: ratio, resolution: "1K" });
    const [width, height] = String(body.size).split("x").map(Number);
    expect(width * height).toBeGreaterThanOrEqual(655360);
    expect(width * height).toBeLessThanOrEqual(8294400);
    expect(width % 16).toBe(0);
    expect(height % 16).toBe(0);
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
  });
});
