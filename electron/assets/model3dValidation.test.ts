import { describe, expect, it } from "vitest";

import { Model3DValidationError, validateGlbStructure } from "./model3dValidation";

function glb(jsonValue: Record<string, unknown>, binary = Buffer.alloc(36)): Buffer {
  const json = Buffer.from(JSON.stringify(jsonValue), "utf8");
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binLength = Math.ceil(binary.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const bytes = Buffer.alloc(total, 0);
  bytes.write("glTF", 0, "ascii");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(total, 8);
  bytes.writeUInt32LE(jsonLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  bytes.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  const binHeader = 20 + jsonLength;
  bytes.writeUInt32LE(binLength, binHeader);
  bytes.writeUInt32LE(0x004e4942, binHeader + 4);
  binary.copy(bytes, binHeader + 8);
  return bytes;
}

function validTriangle(overrides: Record<string, unknown> = {}): Buffer {
  return glb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
    ...overrides,
  });
}

describe("validateGlbStructure", () => {
  it("accepts a self-contained GLB with a reachable scene and mesh", () => {
    expect(validateGlbStructure(validTriangle())).toEqual({ sceneCount: 1, nodeCount: 1, meshCount: 1 });
  });

  it.each([
    ["empty scene", { scenes: [], scene: 0 }],
    ["dangling scene node", { scenes: [{ nodes: [7] }] }],
    ["dangling mesh accessor", { meshes: [{ primitives: [{ attributes: { POSITION: 9 } }] }] }],
    ["dangling buffer view", { accessors: [{ bufferView: 8, componentType: 5126, count: 3, type: "VEC3" }] }],
    ["out-of-range buffer view", { bufferViews: [{ buffer: 0, byteOffset: 30, byteLength: 36 }] }],
  ])("rejects %s references", (_label, overrides) => {
    expect(() => validateGlbStructure(validTriangle(overrides))).toThrow(Model3DValidationError);
  });

  it("rejects external buffer URIs but permits bounded embedded data URIs", () => {
    expect(() => validateGlbStructure(validTriangle({ buffers: [{ byteLength: 36, uri: "https://cdn.invalid/a.bin" }] })))
      .toThrowError(expect.objectContaining({ code: "external_uri" }));

    const embedded = Buffer.alloc(36).toString("base64");
    expect(validateGlbStructure(validTriangle({ buffers: [
      { byteLength: 36 },
      { byteLength: 36, uri: `data:application/octet-stream;base64,${embedded}` },
    ] }))).toMatchObject({ meshCount: 1 });
  });

  it("rejects resource bombs and deeply nested/cyclic node graphs", () => {
    expect(() => validateGlbStructure(validTriangle({
      nodes: Array.from({ length: 20 }, (_, index) => ({ children: index === 19 ? [] : [index + 1], ...(index === 19 ? { mesh: 0 } : {}) })),
      scenes: [{ nodes: [0] }],
    }), { maxDepth: 8 })).toThrowError(expect.objectContaining({ code: "resource_limit" }));

    expect(() => validateGlbStructure(validTriangle({
      nodes: [{ mesh: 0 }, ...Array.from({ length: 20 }, () => ({}))],
    }), { maxResources: 8 })).toThrowError(expect.objectContaining({ code: "resource_limit" }));
  });

  it.each([
    ["accessor byteOffset overflow", { accessors: [{ bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: "VEC3" }] }],
    ["accessor count overflow", { accessors: [{ bufferView: 0, componentType: 5126, count: Number.MAX_SAFE_INTEGER, type: "VEC3" }] }],
    ["undersized byteStride", {
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC3" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 8 }],
    }],
    ["strided accessor overflow", {
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 16 }],
    }],
  ])("rejects %s instead of trusting the bufferView header", (_label, overrides) => {
    expect(() => validateGlbStructure(validTriangle(overrides))).toThrow(Model3DValidationError);
  });

  it.each([
    ["floating-point sparse index type", {
      accessors: [{ componentType: 5126, count: 3, type: "VEC3", sparse: {
        count: 1,
        indices: { bufferView: 0, componentType: 5126 },
        values: { bufferView: 0 },
      } }],
    }],
    ["sparse index bytes overflow", {
      accessors: [{ componentType: 5126, count: 3, type: "VEC3", sparse: {
        count: 2,
        indices: { bufferView: 0, byteOffset: 35, componentType: 5121 },
        values: { bufferView: 0 },
      } }],
    }],
    ["sparse value bytes overflow", {
      accessors: [{ componentType: 5126, count: 3, type: "VEC3", sparse: {
        count: 2,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 0, byteOffset: 24 },
      } }],
    }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => validateGlbStructure(validTriangle(overrides))).toThrow(Model3DValidationError);
  });

  it("rejects sparse indices that are not strictly increasing or exceed accessor.count", () => {
    const binary = Buffer.alloc(64);
    binary.set([1, 1], 0);
    const duplicate = glb({
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ componentType: 5126, count: 3, type: "VEC3", sparse: {
        count: 2, indices: { bufferView: 0, componentType: 5121 }, values: { bufferView: 1 },
      } }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 2 },
        { buffer: 0, byteOffset: 4, byteLength: 24 },
      ],
      buffers: [{ byteLength: 64 }],
    }, binary);
    expect(() => validateGlbStructure(duplicate)).toThrow(Model3DValidationError);

    binary.set([1, 3], 0);
    const outOfRange = Buffer.from(duplicate);
    const jsonLength = outOfRange.readUInt32LE(12);
    const binaryOffset = 20 + jsonLength + 8;
    outOfRange.set(binary, binaryOffset);
    expect(() => validateGlbStructure(outOfRange)).toThrow(Model3DValidationError);
  });

  it("rejects external image URIs and validates the image-texture-material-mesh closure", () => {
    expect(() => validateGlbStructure(validTriangle({
      images: [{ uri: "https://cdn.invalid/texture.png" }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    }))).toThrowError(expect.objectContaining({ code: "external_uri" }));

    expect(() => validateGlbStructure(validTriangle({
      images: [{ bufferView: 1, mimeType: "image/png" }],
      textures: [{ source: 9 }],
      materials: [{ normalTexture: { index: 0 } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 8 },
      ],
      buffers: [{ byteLength: 44 }],
    }))).toThrow(Model3DValidationError);
  });

  it("accepts a bounded embedded PNG texture whose indices close through the rendered mesh", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");
    expect(validateGlbStructure(validTriangle({
      images: [{ uri: `data:image/png;base64,${png.toString("base64")}` }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    }))).toMatchObject({ meshCount: 1 });
  });
});
