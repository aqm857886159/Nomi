type JsonRecord = Record<string, unknown>;

export type Model3DValidationLimits = {
  maxJsonBytes?: number;
  maxResources?: number;
  maxDepth?: number;
  maxEmbeddedBytes?: number;
  maxAccessorElements?: number;
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
  maxAccessorElements: 10_000_000,
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

function decodeBase64(value: string, maxBytes: number): Uint8Array {
  if (value.length % 4 !== 0 || Math.floor((value.length * 3) / 4) > maxBytes) {
    throw new Model3DValidationError("resource_limit");
  }
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Model3DValidationError("corrupt");
  }
}

function decodeEmbeddedBufferUri(uri: string, byteLength: number, maxEmbeddedBytes: number): Uint8Array {
  const match = /^data:application\/octet-stream;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(uri);
  if (!match) throw new Model3DValidationError("external_uri");
  const decoded = decodeBase64(match[1], maxEmbeddedBytes);
  if (decoded.byteLength < byteLength) throw new Model3DValidationError("corrupt");
  return decoded;
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Model3DValidationError("resource_limit");
  return value;
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new Model3DValidationError("resource_limit");
  return value;
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function accessorElementBytes(componentType: number, type: string): number {
  const componentBytes = COMPONENT_BYTES[componentType];
  const components = TYPE_COMPONENTS[type];
  if (!componentBytes || !components) throw new Model3DValidationError("corrupt");
  if (!type.startsWith("MAT")) return checkedMultiply(componentBytes, components);
  const dimension = Number(type.slice(3));
  return checkedMultiply(align4(checkedMultiply(componentBytes, dimension)), dimension);
}

function strictImageDataUri(uri: string, maxEmbeddedBytes: number): { contentType: string; bytes: Uint8Array } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(uri);
  if (!match) throw new Model3DValidationError("external_uri");
  const decoded = decodeBase64(match[2], maxEmbeddedBytes);
  if (!decoded.byteLength) throw new Model3DValidationError("corrupt");
  return { contentType: match[1].toLowerCase(), bytes: decoded };
}

function imageMagic(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
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
  const images = gltf.images === undefined ? [] : records(gltf.images);
  const textures = gltf.textures === undefined ? [] : records(gltf.textures);
  const materials = gltf.materials === undefined ? [] : records(gltf.materials);
  const resourceCount = scenes.length + nodes.length + meshes.length + accessors.length + bufferViews.length + buffers.length
    + images.length + textures.length + materials.length;
  if (!scenes.length || !nodes.length || !meshes.length || !accessors.length || !buffers.length
    || resourceCount > limits.maxResources) throw new Model3DValidationError(resourceCount > limits.maxResources ? "resource_limit" : "corrupt");

  const bufferBytes = buffers.map((buffer, bufferIndex): Uint8Array => {
    const byteLength = nonNegativeInteger(buffer.byteLength);
    if (typeof buffer.uri === "string") return decodeEmbeddedBufferUri(buffer.uri, byteLength, limits.maxEmbeddedBytes);
    if (bufferIndex !== 0 || byteLength > binaryLength || binaryLength - byteLength > 3) throw new Model3DValidationError("corrupt");
    return bytes.subarray(binOffset + 8, binOffset + 8 + byteLength);
  });
  bufferViews.forEach((view) => {
    const buffer = buffers[index(view.buffer, buffers.length)];
    const offset = view.byteOffset === undefined ? 0 : nonNegativeInteger(view.byteOffset);
    const length = nonNegativeInteger(view.byteLength);
    if (checkedAdd(offset, length) > nonNegativeInteger(buffer.byteLength)) throw new Model3DValidationError("corrupt");
    if (view.byteStride !== undefined) {
      const stride = nonNegativeInteger(view.byteStride);
      if (stride < 4 || stride > 252) throw new Model3DValidationError("corrupt");
    }
  });
  const sliceView = (viewIndex: number): Uint8Array => {
    const viewDefinition = bufferViews[index(viewIndex, bufferViews.length)];
    const offset = viewDefinition.byteOffset === undefined ? 0 : nonNegativeInteger(viewDefinition.byteOffset);
    const length = nonNegativeInteger(viewDefinition.byteLength);
    return bufferBytes[index(viewDefinition.buffer, buffers.length)].subarray(offset, checkedAdd(offset, length));
  };
  accessors.forEach((accessor) => {
    const componentType = accessor.componentType as number;
    const count = nonNegativeInteger(accessor.count);
    const type = String(accessor.type);
    if (!Number.isInteger(componentType) || !COMPONENT_BYTES[componentType]
      || count < 1 || count > limits.maxAccessorElements || !TYPE_COMPONENTS[type]) {
      throw new Model3DValidationError("corrupt");
    }
    const elementBytes = accessorElementBytes(componentType, type);
    if (accessor.bufferView !== undefined) {
      const viewDefinition = bufferViews[index(accessor.bufferView, bufferViews.length)];
      const byteOffset = accessor.byteOffset === undefined ? 0 : nonNegativeInteger(accessor.byteOffset);
      if (byteOffset % COMPONENT_BYTES[componentType] !== 0) throw new Model3DValidationError("corrupt");
      const stride = viewDefinition.byteStride === undefined ? elementBytes : nonNegativeInteger(viewDefinition.byteStride);
      if (stride < elementBytes || stride % COMPONENT_BYTES[componentType] !== 0) throw new Model3DValidationError("corrupt");
      const occupied = checkedAdd(checkedMultiply(count - 1, stride), elementBytes);
      if (checkedAdd(byteOffset, occupied) > nonNegativeInteger(viewDefinition.byteLength)) throw new Model3DValidationError("corrupt");
    } else if (!record(accessor.sparse)) {
      throw new Model3DValidationError("corrupt");
    }
    if (record(accessor.sparse)) {
      const sparseCount = nonNegativeInteger(accessor.sparse.count);
      if (!sparseCount || sparseCount > count
        || !record(accessor.sparse.indices) || !record(accessor.sparse.values)) throw new Model3DValidationError("corrupt");
      const indices = accessor.sparse.indices;
      const values = accessor.sparse.values;
      const indicesViewIndex = index(indices.bufferView, bufferViews.length);
      const valuesViewIndex = index(values.bufferView, bufferViews.length);
      const sparseComponentType = indices.componentType as number;
      if (![5121, 5123, 5125].includes(sparseComponentType)) throw new Model3DValidationError("corrupt");
      if (bufferViews[indicesViewIndex].byteStride !== undefined || bufferViews[valuesViewIndex].byteStride !== undefined) {
        throw new Model3DValidationError("corrupt");
      }
      const indexBytes = COMPONENT_BYTES[sparseComponentType];
      const indicesOffset = indices.byteOffset === undefined ? 0 : nonNegativeInteger(indices.byteOffset);
      const valuesOffset = values.byteOffset === undefined ? 0 : nonNegativeInteger(values.byteOffset);
      if (indicesOffset % indexBytes !== 0 || valuesOffset % COMPONENT_BYTES[componentType] !== 0) throw new Model3DValidationError("corrupt");
      if (checkedAdd(indicesOffset, checkedMultiply(sparseCount, indexBytes)) > nonNegativeInteger(bufferViews[indicesViewIndex].byteLength)
        || checkedAdd(valuesOffset, checkedMultiply(sparseCount, elementBytes)) > nonNegativeInteger(bufferViews[valuesViewIndex].byteLength)) {
        throw new Model3DValidationError("corrupt");
      }
      const indexData = sliceView(indicesViewIndex);
      const indexView = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);
      let previous = -1;
      for (let sparseIndex = 0; sparseIndex < sparseCount; sparseIndex += 1) {
        const offset = indicesOffset + sparseIndex * indexBytes;
        const value = sparseComponentType === 5121 ? indexView.getUint8(offset)
          : sparseComponentType === 5123 ? indexView.getUint16(offset, true)
            : indexView.getUint32(offset, true);
        if (value <= previous || value >= count) throw new Model3DValidationError("corrupt");
        previous = value;
      }
    }
  });
  images.forEach((image) => {
    let mimeType = typeof image.mimeType === "string" ? image.mimeType.toLowerCase() : "";
    let imageBytes: Uint8Array;
    if (typeof image.uri === "string") {
      const embedded = strictImageDataUri(image.uri, limits.maxEmbeddedBytes);
      mimeType = mimeType || embedded.contentType;
      if (mimeType !== embedded.contentType) throw new Model3DValidationError("corrupt");
      imageBytes = embedded.bytes;
    } else if (image.bufferView !== undefined) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new Model3DValidationError("corrupt");
      imageBytes = sliceView(index(image.bufferView, bufferViews.length));
    } else {
      throw new Model3DValidationError("external_uri");
    }
    if (imageMagic(imageBytes) !== mimeType) throw new Model3DValidationError("corrupt");
  });
  textures.forEach((texture) => index(texture.source, images.length));
  const textureInfo = (value: unknown): void => {
    if (value === undefined) return;
    if (!record(value)) throw new Model3DValidationError("corrupt");
    index(value.index, textures.length);
  };
  materials.forEach((material) => {
    if (material.pbrMetallicRoughness !== undefined) {
      if (!record(material.pbrMetallicRoughness)) throw new Model3DValidationError("corrupt");
      textureInfo(material.pbrMetallicRoughness.baseColorTexture);
      textureInfo(material.pbrMetallicRoughness.metallicRoughnessTexture);
    }
    textureInfo(material.normalTexture);
    textureInfo(material.occlusionTexture);
    textureInfo(material.emissiveTexture);
  });
  meshes.forEach((mesh) => {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) throw new Model3DValidationError("corrupt");
    mesh.primitives.forEach((primitive) => {
      if (!record(primitive) || !record(primitive.attributes) || Object.keys(primitive.attributes).length === 0) {
        throw new Model3DValidationError("corrupt");
      }
      Object.values(primitive.attributes).forEach((accessor) => index(accessor, accessors.length));
      if (primitive.indices !== undefined) index(primitive.indices, accessors.length);
      if (primitive.material !== undefined) index(primitive.material, materials.length);
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
