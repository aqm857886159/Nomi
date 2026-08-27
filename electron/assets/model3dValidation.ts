type JsonRecord = Record<string, unknown>;

export type Model3DValidationLimits = {
  maxJsonBytes?: number;
  maxResources?: number;
  maxDepth?: number;
  maxEmbeddedBytes?: number;
};

export class Model3DValidationError extends Error {
  readonly code: "corrupt" | "unsupported_version" | "external_uri" | "resource_limit";

  constructor(code: Model3DValidationError["code"]) {
    super(`3D model validation failed (${code})`);
    this.name = "Model3DValidationError";
    this.code = code;
  }
}

const DEFAULTS: Required<Model3DValidationLimits> = {
  maxJsonBytes: 1024 * 1024,
  maxResources: 10_000,
  maxDepth: 256,
  maxEmbeddedBytes: 8 * 1024 * 1024,
};

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(record)) throw new Model3DValidationError("corrupt");
  return value;
}

function index(value: unknown, length: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length) {
    throw new Model3DValidationError("corrupt");
  }
  return value as number;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Model3DValidationError("corrupt");
  return value as number;
}

function validateEmbeddedUri(uri: string, byteLength: number, maxEmbeddedBytes: number): void {
  const match = /^data:application\/octet-stream;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(uri);
  if (!match) throw new Model3DValidationError("external_uri");
  const estimated = Math.floor((match[1].length * 3) / 4);
  if (estimated > maxEmbeddedBytes || estimated < byteLength) throw new Model3DValidationError("resource_limit");
}

export function validateGlbStructure(
  source: Uint8Array,
  options: Model3DValidationLimits = {},
): { sceneCount: number; nodeCount: number; meshCount: number } {
  const limits = { ...DEFAULTS, ...options };
  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const uint32 = (offset: number) => view.getUint32(offset, true);
  if (bytes.byteLength < 20 || ascii(0, 4) !== "glTF"
    || uint32(4) !== 2 || uint32(8) !== bytes.byteLength) {
    throw new Model3DValidationError("corrupt");
  }
  const jsonLength = uint32(12);
  if (!jsonLength || jsonLength > limits.maxJsonBytes || jsonLength % 4 !== 0
    || uint32(16) !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) {
    throw new Model3DValidationError(jsonLength > limits.maxJsonBytes ? "resource_limit" : "corrupt");
  }
  let gltf: JsonRecord;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
    if (!record(parsed)) throw new Error();
    gltf = parsed;
  } catch {
    throw new Model3DValidationError("corrupt");
  }
  if (!record(gltf.asset) || gltf.asset.version !== "2.0") throw new Model3DValidationError("unsupported_version");

  let binaryLength = 0;
  const binOffset = 20 + jsonLength;
  if (binOffset < bytes.byteLength) {
    if (binOffset + 8 > bytes.byteLength || uint32(binOffset + 4) !== 0x004e4942) {
      throw new Model3DValidationError("corrupt");
    }
    binaryLength = uint32(binOffset);
    if (binaryLength % 4 !== 0 || binOffset + 8 + binaryLength !== bytes.byteLength) {
      throw new Model3DValidationError("corrupt");
    }
  }

  const scenes = records(gltf.scenes);
  const nodes = records(gltf.nodes);
  const meshes = records(gltf.meshes);
  const accessors = records(gltf.accessors);
  const bufferViews = records(gltf.bufferViews);
  const buffers = records(gltf.buffers);
  const resourceCount = scenes.length + nodes.length + meshes.length + accessors.length + bufferViews.length + buffers.length;
  if (!scenes.length || !nodes.length || !meshes.length || !accessors.length || !buffers.length
    || resourceCount > limits.maxResources) throw new Model3DValidationError(resourceCount > limits.maxResources ? "resource_limit" : "corrupt");

  buffers.forEach((buffer, bufferIndex) => {
    const byteLength = nonNegativeInteger(buffer.byteLength);
    if (typeof buffer.uri === "string") validateEmbeddedUri(buffer.uri, byteLength, limits.maxEmbeddedBytes);
    else if (bufferIndex !== 0 || byteLength > binaryLength || binaryLength - byteLength > 3) throw new Model3DValidationError("corrupt");
  });
  bufferViews.forEach((view) => {
    const buffer = buffers[index(view.buffer, buffers.length)];
    const offset = view.byteOffset === undefined ? 0 : nonNegativeInteger(view.byteOffset);
    const length = nonNegativeInteger(view.byteLength);
    if (offset + length > nonNegativeInteger(buffer.byteLength)) throw new Model3DValidationError("corrupt");
  });
  accessors.forEach((accessor) => {
    if (accessor.bufferView !== undefined) index(accessor.bufferView, bufferViews.length);
    if (!Number.isInteger(accessor.componentType) || ![5120, 5121, 5122, 5123, 5125, 5126].includes(accessor.componentType as number)
      || nonNegativeInteger(accessor.count) < 1
      || !["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"].includes(String(accessor.type))) {
      throw new Model3DValidationError("corrupt");
    }
    if (record(accessor.sparse)) {
      const sparseCount = nonNegativeInteger(accessor.sparse.count);
      if (!sparseCount || sparseCount > nonNegativeInteger(accessor.count)
        || !record(accessor.sparse.indices) || !record(accessor.sparse.values)) throw new Model3DValidationError("corrupt");
      index(accessor.sparse.indices.bufferView, bufferViews.length);
      index(accessor.sparse.values.bufferView, bufferViews.length);
    }
  });
  meshes.forEach((mesh) => {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) throw new Model3DValidationError("corrupt");
    mesh.primitives.forEach((primitive) => {
      if (!record(primitive) || !record(primitive.attributes) || Object.keys(primitive.attributes).length === 0) {
        throw new Model3DValidationError("corrupt");
      }
      Object.values(primitive.attributes).forEach((accessor) => index(accessor, accessors.length));
      if (primitive.indices !== undefined) index(primitive.indices, accessors.length);
    });
  });
  nodes.forEach((node) => {
    if (node.mesh !== undefined) index(node.mesh, meshes.length);
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Model3DValidationError("corrupt");
      node.children.forEach((child) => index(child, nodes.length));
    }
  });
  const selectedScene = scenes[index(gltf.scene ?? 0, scenes.length)];
  if (!Array.isArray(selectedScene.nodes) || !selectedScene.nodes.length) throw new Model3DValidationError("corrupt");
  const visiting = new Set<number>();
  const visited = new Set<number>();
  let reachableMesh = false;
  const visit = (nodeIndex: number, depth: number): void => {
    if (depth > limits.maxDepth) throw new Model3DValidationError("resource_limit");
    if (visiting.has(nodeIndex)) throw new Model3DValidationError("corrupt");
    if (visited.has(nodeIndex)) return;
    visiting.add(nodeIndex);
    const node = nodes[index(nodeIndex, nodes.length)];
    if (node.mesh !== undefined) reachableMesh = true;
    if (Array.isArray(node.children)) node.children.forEach((child) => visit(index(child, nodes.length), depth + 1));
    visiting.delete(nodeIndex);
    visited.add(nodeIndex);
  };
  selectedScene.nodes.forEach((node) => visit(index(node, nodes.length), 1));
  if (!reachableMesh) throw new Model3DValidationError("corrupt");
  return { sceneCount: scenes.length, nodeCount: nodes.length, meshCount: meshes.length };
}
