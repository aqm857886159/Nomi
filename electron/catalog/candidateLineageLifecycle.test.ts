import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import { deleteModelCatalogVendor, listModelCatalogModels, readCatalog } from "./catalogStore";
import { deriveModelListing } from "./modelCatalogListing";
import { CURRENT_CATALOG_VERSION, selectTaskMapping, type CatalogState, type Vendor } from "./types";

const now = "2026-08-28T00:00:00.000Z";

function vendor(key: string, meta?: unknown): Vendor {
  return {
    key,
    name: key,
    enabled: true,
    baseUrlHint: `https://${key}.example.test/v1`,
    authType: "bearer",
    ...(meta ? { meta } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function writeState(state: CatalogState): void {
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-candidate-lineage-"));
});

afterEach(() => {
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

describe("candidate vendor lineage deletion", () => {
  it("deleting a root source cascades through every candidate revision and leaves no orphan secret/model/mapping", () => {
    const root = "source";
    const first = "source--candidate-first";
    const second = "source--candidate-second";
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [
        vendor(root),
        vendor(first, {
          adapterCandidateSourceVendorKey: root,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "first",
        }),
        vendor(second, {
          adapterCandidateSourceVendorKey: first,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "second",
        }),
      ],
      models: [root, first, second].map((vendorKey) => ({
        vendorKey,
        modelKey: "image-v1",
        labelZh: "Image V1",
        kind: "image" as const,
        enabled: vendorKey === second,
        createdAt: now,
        updatedAt: now,
      })),
      mappings: [root, first, second].map((vendorKey) => ({
        id: `mapping-${vendorKey}`,
        vendorKey,
        modelKey: "image-v1",
        taskKind: "text_to_image" as const,
        name: "image",
        enabled: vendorKey === second,
        create: { method: "POST", path: "/images" },
        createdAt: now,
        updatedAt: now,
      })),
      apiKeysByVendor: Object.fromEntries([root, first, second].map((vendorKey) => [vendorKey, {
        vendorKey,
        apiKey: Buffer.from(`${vendorKey}-key`).toString("base64"),
        enc: "safeStorage" as const,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }])),
    });

    deleteModelCatalogVendor(root);

    expect(readCatalog()).toMatchObject({ vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
  });

  it("deleting a promoted candidate restores its immediate source execution and removes candidate descendants", () => {
    const root = "source";
    const candidate = "source--candidate-promoted";
    const child = "source--candidate-unpublished-child";
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [
        vendor(root),
        vendor(candidate, {
          adapterCandidateSourceVendorKey: root,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "promoted",
          adapterCandidatePromotionPredecessors: {
            target: { vendorKey: root, publishedModes: ["text_to_image"] },
          },
        }),
        vendor(child, {
          adapterCandidateSourceVendorKey: candidate,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "child",
        }),
      ],
      models: [
        { vendorKey: root, modelKey: "target", labelZh: "Target", kind: "image", enabled: false, createdAt: now, updatedAt: now },
        { vendorKey: root, modelKey: "sibling", labelZh: "Sibling", kind: "video", enabled: true, createdAt: now, updatedAt: now },
        { vendorKey: candidate, modelKey: "target", labelZh: "Target", kind: "image", enabled: true, createdAt: now, updatedAt: now },
        { vendorKey: child, modelKey: "target", labelZh: "Target", kind: "image", enabled: false, createdAt: now, updatedAt: now },
      ],
      mappings: [
        { id: "source-target", vendorKey: root, modelKey: "target", taskKind: "text_to_image", name: "target", enabled: false, create: { method: "POST", path: "/source" }, createdAt: now, updatedAt: now },
        { id: "source-sibling", vendorKey: root, modelKey: "sibling", taskKind: "text_to_video", name: "sibling", enabled: true, create: { method: "POST", path: "/sibling" }, createdAt: now, updatedAt: now },
        { id: "candidate-target", vendorKey: candidate, modelKey: "target", taskKind: "text_to_image", name: "target", enabled: true, create: { method: "POST", path: "/candidate" }, createdAt: now, updatedAt: now },
        { id: "child-target", vendorKey: child, modelKey: "target", taskKind: "text_to_image", name: "target", enabled: false, create: { method: "POST", path: "/child" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: Object.fromEntries([root, candidate, child].map((vendorKey) => [vendorKey, {
        vendorKey,
        apiKey: Buffer.from(`${vendorKey}-key`).toString("base64"),
        enc: "safeStorage" as const,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }])),
    });

    deleteModelCatalogVendor(candidate);

    const state = readCatalog();
    expect(state.vendors.map((item) => item.key)).toEqual([root]);
    expect(state.models.find((model) => model.vendorKey === root && model.modelKey === "target")?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.id === "source-target")?.enabled).toBe(true);
    expect(state.models.find((model) => model.modelKey === "sibling")?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.id === "source-sibling")?.enabled).toBe(true);
    expect(Object.keys(state.apiKeysByVendor)).toEqual([root]);
  });

  it("restores every source mode disabled by promotion even when the candidate published only one mode", () => {
    const root = "source";
    const candidate = "source--candidate-partial";
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [
        vendor(root),
        vendor(candidate, {
          adapterCandidateSourceVendorKey: root,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "partial",
          adapterCandidatePromotionPredecessors: {
            target: {
              vendorKey: root,
              publishedModes: ["text_to_image", "image_edit"],
            },
          },
        }),
      ],
      models: [
        { vendorKey: root, modelKey: "target", labelZh: "Target", kind: "image", enabled: false, createdAt: now, updatedAt: now },
        { vendorKey: candidate, modelKey: "target", labelZh: "Target", kind: "image", enabled: true, createdAt: now, updatedAt: now },
      ],
      mappings: [
        { id: "source-t2i", vendorKey: root, modelKey: "target", taskKind: "text_to_image", name: "source t2i", enabled: false, create: { method: "POST", path: "/source-t2i" }, createdAt: now, updatedAt: now },
        { id: "source-edit", vendorKey: root, modelKey: "target", taskKind: "image_edit", name: "source edit", enabled: false, create: { method: "POST", path: "/source-edit" }, createdAt: now, updatedAt: now },
        { id: "candidate-t2i", vendorKey: candidate, modelKey: "target", taskKind: "text_to_image", name: "candidate t2i", enabled: true, create: { method: "POST", path: "/candidate-t2i" }, createdAt: now, updatedAt: now },
        { id: "candidate-edit", vendorKey: candidate, modelKey: "target", taskKind: "image_edit", name: "candidate edit", enabled: false, create: { method: "POST", path: "/candidate-edit" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: {
        [root]: {
          vendorKey: root,
          apiKey: Buffer.from("root-key").toString("base64"),
          enc: "safeStorage",
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
        [candidate]: {
          vendorKey: candidate,
          apiKey: Buffer.from("candidate-key").toString("base64"),
          enc: "safeStorage",
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    deleteModelCatalogVendor(candidate);

    const state = readCatalog();
    expect(state.models.find((model) => model.vendorKey === root && model.modelKey === "target")?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.id === "source-t2i")?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.id === "source-edit")?.enabled).toBe(true);
    expect(state.vendors.map((item) => item.key)).toEqual([root]);
    expect(Object.keys(state.apiKeysByVendor)).toEqual([root]);
  });

  it("deleting a non-leaf predecessor follows per-model reverse dependencies across two sources and restores one executable contract", () => {
    const root = "source";
    const predecessor = "source--candidate-predecessor";
    const successor = "source--candidate-successor";
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [
        vendor(root),
        vendor(predecessor, {
          adapterCandidateSourceVendorKey: root,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "predecessor",
          adapterCandidatePromotionPredecessors: {
            image: { vendorKey: root, publishedModes: ["text_to_image", "image_edit"] },
          },
        }),
        vendor(successor, {
          // The save started from root, but its models had different active predecessors.
          adapterCandidateSourceVendorKey: root,
          adapterCandidateRootVendorKey: root,
          adapterCandidateRevisionId: "successor",
          adapterCandidatePromotionPredecessors: {
            image: { vendorKey: predecessor, publishedModes: ["text_to_image"] },
            video: { vendorKey: root, publishedModes: ["text_to_video"] },
          },
        }),
      ],
      models: [
        { vendorKey: root, modelKey: "image", labelZh: "Image", kind: "image", enabled: false, createdAt: now, updatedAt: now },
        { vendorKey: root, modelKey: "video", labelZh: "Video", kind: "video", enabled: false, createdAt: now, updatedAt: now },
        { vendorKey: predecessor, modelKey: "image", labelZh: "Image", kind: "image", enabled: false, createdAt: now, updatedAt: now },
        { vendorKey: successor, modelKey: "image", labelZh: "Image", kind: "image", enabled: true, createdAt: now, updatedAt: now },
        { vendorKey: successor, modelKey: "video", labelZh: "Video", kind: "video", enabled: true, createdAt: now, updatedAt: now },
      ],
      mappings: [
        { id: "root-image-t2i", vendorKey: root, modelKey: "image", taskKind: "text_to_image", name: "root image", enabled: false, create: { method: "POST", path: "/root-image" }, createdAt: now, updatedAt: now },
        { id: "root-image-edit", vendorKey: root, modelKey: "image", taskKind: "image_edit", name: "root edit", enabled: false, create: { method: "POST", path: "/root-edit" }, createdAt: now, updatedAt: now },
        { id: "root-video", vendorKey: root, modelKey: "video", taskKind: "text_to_video", name: "root video", enabled: false, create: { method: "POST", path: "/root-video" }, createdAt: now, updatedAt: now },
        { id: "predecessor-image", vendorKey: predecessor, modelKey: "image", taskKind: "text_to_image", name: "predecessor image", enabled: false, create: { method: "POST", path: "/predecessor" }, createdAt: now, updatedAt: now },
        { id: "successor-image", vendorKey: successor, modelKey: "image", taskKind: "text_to_image", name: "successor image", enabled: true, create: { method: "POST", path: "/successor-image" }, createdAt: now, updatedAt: now },
        { id: "successor-video", vendorKey: successor, modelKey: "video", taskKind: "text_to_video", name: "successor video", enabled: true, create: { method: "POST", path: "/successor-video" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: Object.fromEntries([root, predecessor, successor].map((vendorKey) => [vendorKey, {
        vendorKey,
        apiKey: Buffer.from(`${vendorKey}-key`).toString("base64"),
        enc: "safeStorage" as const,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }])),
    });

    deleteModelCatalogVendor(predecessor);

    const state = readCatalog();
    expect(state.vendors.map((item) => item.key)).toEqual([root]);
    expect(Object.keys(state.apiKeysByVendor)).toEqual([root]);
    expect(state.models).toHaveLength(2);
    expect(state.models.every((model) => model.vendorKey === root && model.enabled)).toBe(true);
    expect(state.mappings.filter((mapping) => mapping.enabled).map((mapping) => mapping.id).sort()).toEqual([
      "root-image-edit",
      "root-image-t2i",
      "root-video",
    ]);
    expect(deriveModelListing(state).map((model) => `${model.vendor}/${model.modelKey}`).sort()).toEqual([
      "source/image",
      "source/video",
    ]);

    const once = JSON.stringify(state);
    deleteModelCatalogVendor(predecessor);
    expect(JSON.stringify(readCatalog())).toBe(once);
  });

  it("walks multi-level and branched predecessor references even when sourceVendorKey points elsewhere", () => {
    const root = "source";
    const predecessor = "source--candidate-a";
    const child = "source--candidate-b";
    const branch = "source--candidate-c";
    const candidateMeta = (revisionId: string, predecessorVendorKey: string) => ({
      adapterCandidateSourceVendorKey: root,
      adapterCandidateRootVendorKey: root,
      adapterCandidateRevisionId: revisionId,
      adapterCandidatePromotionPredecessors: {
        image: { vendorKey: predecessorVendorKey, publishedModes: ["text_to_image"] },
      },
    });
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [
        vendor(root),
        vendor(predecessor, candidateMeta("a", root)),
        vendor(child, candidateMeta("b", predecessor)),
        vendor(branch, candidateMeta("c", predecessor)),
      ],
      models: [root, predecessor, child, branch].map((vendorKey) => ({
        vendorKey,
        modelKey: "image",
        labelZh: "Image",
        kind: "image" as const,
        enabled: vendorKey === child || vendorKey === branch,
        createdAt: now,
        updatedAt: now,
      })),
      mappings: [root, predecessor, child, branch].map((vendorKey) => ({
        id: `mapping-${vendorKey}`,
        vendorKey,
        modelKey: "image",
        taskKind: "text_to_image" as const,
        name: vendorKey,
        enabled: vendorKey === child || vendorKey === branch,
        create: { method: "POST", path: `/${vendorKey}` },
        createdAt: now,
        updatedAt: now,
      })),
      apiKeysByVendor: Object.fromEntries([root, predecessor, child, branch].map((vendorKey) => [vendorKey, {
        vendorKey,
        apiKey: Buffer.from(`${vendorKey}-key`).toString("base64"),
        enc: "safeStorage" as const,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }])),
    });

    deleteModelCatalogVendor(predecessor);

    const state = readCatalog();
    expect(state.vendors.map((item) => item.key)).toEqual([root]);
    expect(state.models).toHaveLength(1);
    expect(state.models[0]).toMatchObject({ vendorKey: root, modelKey: "image", enabled: true });
    expect(state.mappings).toHaveLength(1);
    expect(state.mappings[0]).toMatchObject({ vendorKey: root, modelKey: "image", enabled: true });
    expect(Object.keys(state.apiKeysByVendor)).toEqual([root]);
  });

  it("does not restore a predecessor mode while a surviving published successor still replaces it", () => {
    const root = "source";
    const deleting = "source--candidate-deleting";
    const survivor = "source--candidate-survivor";
    const meta = (revisionId: string) => ({
      adapterCandidateSourceVendorKey: root,
      adapterCandidateRootVendorKey: root,
      adapterCandidateRevisionId: revisionId,
      adapterCandidatePromotionPredecessors: {
        image: { vendorKey: root, publishedModes: ["text_to_image"] },
      },
    });
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [vendor(root), vendor(deleting, meta("deleting")), vendor(survivor, meta("survivor"))],
      models: [
        { vendorKey: root, modelKey: "image", labelZh: "Image", kind: "image", enabled: false, createdAt: now, updatedAt: now },
        { vendorKey: deleting, modelKey: "image", labelZh: "Image", kind: "image", enabled: true, createdAt: now, updatedAt: now },
        { vendorKey: survivor, modelKey: "image", labelZh: "Image", kind: "image", enabled: true, createdAt: now, updatedAt: now },
      ],
      mappings: [
        { id: "root", vendorKey: root, modelKey: "image", taskKind: "text_to_image", name: "root", enabled: false, create: { method: "POST", path: "/root" }, createdAt: now, updatedAt: now },
        { id: "deleting", vendorKey: deleting, modelKey: "image", taskKind: "text_to_image", name: "deleting", enabled: true, create: { method: "POST", path: "/deleting" }, createdAt: now, updatedAt: now },
        { id: "survivor", vendorKey: survivor, modelKey: "image", taskKind: "text_to_image", name: "survivor", enabled: true, create: { method: "POST", path: "/survivor" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: Object.fromEntries([root, deleting, survivor].map((vendorKey) => [vendorKey, {
        vendorKey,
        apiKey: Buffer.from(`${vendorKey}-key`).toString("base64"),
        enc: "safeStorage" as const,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }])),
    });

    deleteModelCatalogVendor(deleting);

    const state = readCatalog();
    expect(state.vendors.map((item) => item.key)).toEqual([root, survivor]);
    expect(state.models.find((model) => model.vendorKey === root)?.enabled).toBe(false);
    expect(state.mappings.find((mapping) => mapping.vendorKey === root)?.enabled).toBe(false);
    expect(deriveModelListing(state).map((model) => `${model.vendor}/${model.modelKey}`)).toEqual([
      `${survivor}/image`,
    ]);
  });

  it("restores only unoccupied predecessor modes in DTO, picker evidence, and runtime mappings, then restores the final mode", () => {
    const root = "source";
    const survivor = "source--candidate-t2i";
    const sibling = "source--candidate-edit";
    const predecessorMeta = (revisionId: string, mode: "text_to_image" | "image_edit") => ({
      adapterCandidateSourceVendorKey: root,
      adapterCandidateRootVendorKey: root,
      adapterCandidateRevisionId: revisionId,
      adapterCandidatePromotionPredecessors: {
        image: { vendorKey: root, publishedModes: [mode] },
      },
    });
    writeState({
      version: CURRENT_CATALOG_VERSION,
      vendors: [vendor(root), vendor(survivor, predecessorMeta("t2i", "text_to_image")), vendor(sibling, predecessorMeta("edit", "image_edit"))],
      models: [
        {
          vendorKey: root,
          modelKey: "image",
          labelZh: "Image",
          kind: "image",
          enabled: false,
          meta: { adapter: {
            state: "verified",
            activeRevision: "root-revision",
            publicationModes: [],
            modes: [
              { taskKind: "text_to_image", state: "verified" },
              { taskKind: "image_edit", state: "verified" },
            ],
          } },
          createdAt: now,
          updatedAt: now,
        },
        { vendorKey: survivor, modelKey: "image", labelZh: "Image", kind: "image", enabled: true, createdAt: now, updatedAt: now },
        { vendorKey: sibling, modelKey: "image", labelZh: "Image", kind: "image", enabled: true, createdAt: now, updatedAt: now },
      ],
      mappings: [
        { id: "root-t2i", vendorKey: root, modelKey: "image", taskKind: "text_to_image", name: "root t2i", enabled: false, create: { method: "POST", path: "/root-t2i" }, createdAt: now, updatedAt: now },
        { id: "root-edit", vendorKey: root, modelKey: "image", taskKind: "image_edit", name: "root edit", enabled: false, create: { method: "POST", path: "/root-edit" }, createdAt: now, updatedAt: now },
        { id: "survivor-t2i", vendorKey: survivor, modelKey: "image", taskKind: "text_to_image", name: "survivor t2i", enabled: true, create: { method: "POST", path: "/survivor-t2i" }, createdAt: now, updatedAt: now },
        { id: "sibling-edit", vendorKey: sibling, modelKey: "image", taskKind: "image_edit", name: "sibling edit", enabled: true, create: { method: "POST", path: "/sibling-edit" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: Object.fromEntries([root, survivor, sibling].map((vendorKey) => [vendorKey, {
        vendorKey,
        apiKey: Buffer.from(`${vendorKey}-key`).toString("base64"),
        enc: "safeStorage" as const,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }])),
    });

    deleteModelCatalogVendor(sibling);

    let state = readCatalog();
    const sourceDto = listModelCatalogModels({ vendorKey: root })[0];
    expect(sourceDto).toMatchObject({ enabled: true, published: true, publishedModes: ["image_edit"] });
    expect((sourceDto.meta as { adapter: { publicationModes: string[] } }).adapter.publicationModes).toEqual(["image_edit"]);
    expect(selectTaskMapping(state.mappings, root, "text_to_image", "image")).toBeNull();
    expect(selectTaskMapping(state.mappings, root, "image_edit", "image")?.id).toBe("root-edit");
    expect(listModelCatalogModels({ kind: "image", enabled: true }).filter((model) => model.publishedModes.includes("text_to_image")))
      .toMatchObject([{ vendorKey: survivor }]);

    deleteModelCatalogVendor(survivor);

    state = readCatalog();
    expect(listModelCatalogModels({ vendorKey: root })[0]).toMatchObject({
      enabled: true,
      published: true,
      publishedModes: ["text_to_image", "image_edit"],
    });
    expect(selectTaskMapping(state.mappings, root, "text_to_image", "image")?.id).toBe("root-t2i");
    expect(selectTaskMapping(state.mappings, root, "image_edit", "image")?.id).toBe("root-edit");

    const once = JSON.stringify(state);
    deleteModelCatalogVendor(survivor);
    expect(JSON.stringify(readCatalog())).toBe(once);
  });
});
