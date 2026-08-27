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
});
