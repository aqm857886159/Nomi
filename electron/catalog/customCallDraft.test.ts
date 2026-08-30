import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import { listModelCatalogModels, listModelCatalogVendors, readCatalog, upsertModelCatalogModel } from "./catalogStore";
import { createCustomCallDraft, finalizeCustomCallDraft } from "./customCallDraft";
import { decryptApiKeyRecord } from "./secrets";

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-custom-call-draft-"));
  tempRoots.push(dir);
  return dir;
}

describe("direct custom-call draft persistence", () => {
  beforeEach(() => {
    mockedUserDataRoot = makeTempDir();
  });

  afterEach(() => {
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("atomically stores one vendor, credential, and disabled model without a mapping or script", () => {
    const identity = createCustomCallDraft({
      vendorName: "My brand-new provider",
      baseUrl: "https://api.new-provider.test/v2",
      apiKey: "sk-current-user-input",
      authType: "bearer",
      modelKey: "new-image-model",
      kind: "image",
    });

    expect(identity).toEqual({
      vendorKey: expect.stringMatching(/^custom-script-/),
      modelKey: "new-image-model",
      label: "New Image Model",
      kind: "image",
    });
    expect(JSON.stringify(identity)).not.toContain("sk-current-user-input");

    expect(listModelCatalogVendors()).toEqual([
      expect.objectContaining({
        key: identity.vendorKey,
        name: "My brand-new provider",
        baseUrlHint: "https://api.new-provider.test/v2",
        authType: "bearer",
        enabled: true,
        hasApiKey: true,
        meta: { customCallOnly: true },
      }),
    ]);
    expect(decryptApiKeyRecord(readCatalog().apiKeysByVendor[identity.vendorKey])).toBe("sk-current-user-input");
    const draftModels = listModelCatalogModels();
    expect(draftModels).toHaveLength(1);
    expect(draftModels[0]).toEqual(
      expect.objectContaining({
        vendorKey: identity.vendorKey,
        modelKey: "new-image-model",
        kind: "image",
        enabled: false,
        meta: expect.objectContaining({ customCallDraft: expect.any(Object) }),
        onboarding: expect.objectContaining({ addedVia: "manual" }),
      }),
    );
    expect(draftModels[0].customCall).toBeUndefined();
    expect(readCatalog().mappings).toEqual([]);
  });

  it("supports an absolute-URL script draft with no base URL and auth none", () => {
    const identity = createCustomCallDraft({
      vendorName: "Webhook-free API",
      baseUrl: "",
      apiKey: "must-be-ignored-for-none-auth",
      authType: "none",
      modelKey: "absolute-url-video",
      kind: "video",
    });

    expect(listModelCatalogVendors()[0]).toMatchObject({
      key: identity.vendorKey,
      baseUrlHint: null,
      authType: "none",
      hasApiKey: false,
    });
    expect(readCatalog().apiKeysByVendor[identity.vendorKey]).toBeUndefined();
  });

  it("keeps the model disabled until a non-empty script is finalized, then enables it in the same write", () => {
    const identity = createCustomCallDraft({
      vendorName: "Draft provider",
      baseUrl: "",
      apiKey: "",
      authType: "none",
      modelKey: "draft-text",
      kind: "text",
    });

    expect(() => finalizeCustomCallDraft({ ...identity, script: "   " })).toThrow(/script/i);
    expect(listModelCatalogModels()[0].enabled).toBe(false);
    expect(listModelCatalogModels()[0].customCall).toBeUndefined();

    const finalized = finalizeCustomCallDraft({
      vendorKey: identity.vendorKey,
      modelKey: identity.modelKey,
      script: "return { text: 'ready' }",
    });
    expect(finalized).toEqual(identity);
    expect(listModelCatalogModels()[0]).toMatchObject({
      enabled: true,
      customCall: { script: "return { text: 'ready' }", updatedAt: expect.any(String) },
      meta: {},
    });
  });

  it("keeps an unknown media model disabled after its tested script is finalized", () => {
    const identity = createCustomCallDraft({
      vendorName: "Future image provider",
      baseUrl: "",
      apiKey: "",
      authType: "none",
      modelKey: "future-image-model-with-unknown-inputs",
      kind: "image",
    });

    finalizeCustomCallDraft({
      vendorKey: identity.vendorKey,
      modelKey: identity.modelKey,
      script: "return { image_url: 'https://cdn.example.test/result.png' }",
    });

    expect(listModelCatalogModels()[0]).toMatchObject({
      enabled: false,
      customCall: { script: expect.stringContaining("image_url") },
      meta: {},
    });
  });

  it("enables a media model whose identity already has a built-in capability profile", () => {
    const identity = createCustomCallDraft({
      vendorName: "Seedance relay",
      baseUrl: "",
      apiKey: "",
      authType: "none",
      modelKey: "bytedance/seedance-2",
      kind: "video",
    });

    finalizeCustomCallDraft({
      vendorKey: identity.vendorKey,
      modelKey: identity.modelKey,
      script: "return { video_url: 'https://cdn.example.test/result.mp4' }",
    });

    expect(listModelCatalogModels()[0]).toMatchObject({
      enabled: true,
      customCall: { script: expect.stringContaining("video_url") },
      meta: {},
    });
  });

  it("enables an unknown media model when it already has a custom capability contract", () => {
    const identity = createCustomCallDraft({
      vendorName: "Future video provider",
      baseUrl: "",
      apiKey: "",
      authType: "none",
      modelKey: "future-video-model-with-explicit-inputs",
      kind: "video",
    });
    const draft = listModelCatalogModels()[0];
    const customCapabilityContract = {
      version: 1,
      kind: "video",
      defaultModeId: "prompt-video",
      transportTaskKind: "text_to_video",
      modes: [{
        id: "prompt-video",
        intent: "text",
        vendorTerm: "Prompt video",
        hint: "",
        promptRequired: true,
        transportTaskKind: "text_to_video",
        slots: [],
        params: [],
      }],
    };
    upsertModelCatalogModel({
      vendorKey: identity.vendorKey,
      modelKey: identity.modelKey,
      meta: {
        ...(draft.meta && typeof draft.meta === "object" ? draft.meta : {}),
        customCapabilityContract,
      },
    });

    finalizeCustomCallDraft({
      vendorKey: identity.vendorKey,
      modelKey: identity.modelKey,
      script: "return { video_url: 'https://cdn.example.test/result.mp4' }",
    });

    expect(listModelCatalogModels()[0]).toMatchObject({
      enabled: true,
      customCall: { script: expect.stringContaining("video_url") },
      meta: { customCapabilityContract },
    });
  });

  it("rolls the whole draft back when credential validation fails after the vendor step", () => {
    expect(() => createCustomCallDraft({
      vendorName: "Broken provider",
      baseUrl: "https://broken.test",
      apiKey: "bad-key-中文",
      authType: "bearer",
      modelKey: "should-not-remain",
      kind: "image",
    })).toThrow();

    expect(listModelCatalogVendors()).toEqual([]);
    expect(listModelCatalogModels()).toEqual([]);
    expect(readCatalog().apiKeysByVendor).toEqual({});
  });
});
