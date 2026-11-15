#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { bodyReferencedParamKeys } from "../electron/catalog/paramTranslate";
import { referenceKeyDeclarationFor, referenceKeyCapacityDeclarationFor } from "../electron/shared/modelArchetypes/referenceKeys";
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins";
import type { CatalogState } from "../electron/catalog/types";
import { GENERIC_REFERENCE_KEYS } from "../electron/shared/modelArchetypes/referenceKeys";
import { EVERY_VARIANT, resolveModelArchetype } from "../electron/shared/modelArchetypes";
import { getArchetypeById } from "../electron/shared/modelArchetypes/builtInCatalog";
import type { ModelParameterControl } from "../electron/shared/videoCapabilities/types";

const NOW = "2026-10-25T00:00:00.000Z";

type CensusClassification = {
  role: "reference-input" | "boolean-switch" | "enum" | "size" | "quantity" | "number" | "voice";
  detail: string;
  basis: string;
};

const KNOWN_NON_REFERENCE: Record<string, CensusClassification> = {
  audio: { role: "boolean-switch", detail: "生成音频开关", basis: "wire key semantics" },
  generateAudio: { role: "boolean-switch", detail: "生成音频开关", basis: "wire key semantics" },
  video_require_audio: { role: "boolean-switch", detail: "参考视频必须含音轨开关", basis: "wire key semantics" },
  audio_setting: { role: "enum", detail: "音频处理枚举", basis: "archetype parameter control / wire key" },
  voice: { role: "voice", detail: "音色枚举", basis: "archetype parameter control / wire key" },
  voice_id: { role: "voice", detail: "音色 ID 文本", basis: "archetype parameter control / wire key" },
  voice_preset_id: { role: "voice", detail: "音色预设枚举", basis: "archetype parameter control / wire key" },
  image_size: { role: "size", detail: "图像尺寸枚举", basis: "wire key semantics" },
  num_images: { role: "quantity", detail: "生成数量", basis: "wire key semantics" },
  num_frames: { role: "quantity", detail: "视频帧数", basis: "wire key semantics" },
  frame_rate: { role: "number", detail: "帧率数值", basis: "archetype parameter control / wire key" },
  video_start_seconds: { role: "number", detail: "参考视频起始秒数", basis: "archetype parameter control / wire key" },
};

function parameterControl(archetypeId: string | undefined, key: string): ModelParameterControl | undefined {
  const archetype = archetypeId ? getArchetypeById(archetypeId) : null;
  for (const mode of archetype?.modes ?? []) {
    const control = mode.params.find((candidate) => candidate.key === key);
    if (control) return control;
  }
  return undefined;
}

function actualClassification(archetypeId: string | undefined, key: string): CensusClassification {
  if (GENERIC_REFERENCE_KEYS.has(key)) {
    return {
      role: "reference-input",
      detail: "档案槽或 headlessReferenceKeys 声明的参考输入",
      basis: "GENERIC_REFERENCE_KEYS",
    };
  }
  const control = parameterControl(archetypeId, key);
  if (control) {
    const role = control.type === "boolean"
      ? "boolean-switch"
      : control.type === "select"
        ? (control.label.includes("音频") ? "enum" : control.label.includes("音色") ? "voice" : "enum")
        : control.type === "number" ? "number" : "enum";
    return { role, detail: `${control.label}（${control.type}）`, basis: "ModelParameterControl" };
  }
  const known = KNOWN_NON_REFERENCE[key];
  if (known) return known;
  throw new Error(`unclassified non-reference key: ${key}`);
}

function outputPath(argv: string[]): string {
  const index = argv.indexOf("--out");
  return index >= 0 && argv[index + 1]
    ? path.resolve(argv[index + 1])
    : path.resolve("docs/evidence/2026-10-25-reference-key-census/census.json");
}

export function buildReferenceKeyCensus() {
  const initial: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const { state } = applyBuiltinSeeds(initial, NOW);
  const modelByKey = new Map(state.models.map((model) => [`${model.vendorKey}:${model.modelKey}`, model]));
  const modelContexts = state.models.map((model) => ({
    model,
    archetype: resolveModelArchetype({
      modelKey: model.modelKey,
      modelAlias: model.modelAlias,
      vendorKey: model.vendorKey,
      meta: model.meta,
    }, { variant: EVERY_VARIANT }),
  }));
  const modelsWithReferenceDeclarations = modelContexts.filter(({ archetype }) =>
    Boolean(archetype?.headlessReferenceKeys?.length || archetype?.modes.some((mode) => mode.slots.length > 0 || mode.combineSlotsInto)),
  ).length;
  const rows = state.mappings.flatMap((mapping) => {
    const referencedKeys = bodyReferencedParamKeys(mapping.create?.body)
      .filter((key) => referenceKeyDeclarationFor(key));
    if (referencedKeys.length === 0) return [];
    const model = mapping.modelKey ? modelByKey.get(`${mapping.vendorKey}:${mapping.modelKey}`) : undefined;
    const archetypeId = typeof (model?.meta as Record<string, unknown> | undefined)?.archetypeId === "string"
      ? (model?.meta as Record<string, string>).archetypeId
      : undefined;
    const context = {
      vendorKey: mapping.vendorKey,
      modelKey: mapping.modelKey,
      modelAlias: model?.modelAlias,
      modelMeta: model?.meta,
      taskKind: mapping.taskKind,
    };
    return [{
      id: mapping.id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      modelKey: mapping.modelKey ?? null,
      archetypeId: archetypeId ?? null,
      keys: referencedKeys.map((key) => ({
        key,
        classifier: referenceKeyDeclarationFor(key),
        capacity: referenceKeyCapacityDeclarationFor(key, context),
        capacitySource: referenceKeyCapacityDeclarationFor(key, context)?.source === "model-declaration" ? "模型声明" : "键名形态推断",
        actual: actualClassification(archetypeId, key),
      })),
    }];
  });
  const falsePositiveRows = rows.filter((row) => row.keys.some((entry) => entry.actual.role !== "reference-input"));
  const falsePositiveKeys = [...new Set(falsePositiveRows.flatMap((row) => row.keys
    .filter((entry) => entry.actual.role !== "reference-input")
    .map((entry) => entry.key)))].sort();
  return {
    generatedAt: NOW,
    source: {
      catalog: "electron/catalog/seedBuiltins.ts::applyBuiltinSeeds",
      bodyKeyExtraction: "electron/catalog/paramTranslate.ts::bodyReferencedParamKeys",
      classifier: "electron/shared/modelArchetypes/referenceKeys.ts::referenceKeyDeclarationFor",
      declarationSet: "electron/shared/modelArchetypes/referenceKeys.ts::GENERIC_REFERENCE_KEYS",
    },
    summary: {
      seededVendors: state.vendors.length,
      seededModels: state.models.length,
      seededMappings: state.mappings.length,
      rowsWithClassifiedKeys: rows.length,
      falsePositiveRows: falsePositiveRows.length,
      falsePositiveKeys: falsePositiveKeys.length,
      falsePositiveKeyNames: falsePositiveKeys,
      falsePositiveCategories: [...new Set(falsePositiveRows.flatMap((row) => row.keys
        .filter((entry) => entry.actual.role !== "reference-input")
        .map((entry) => entry.actual.role)))].sort(),
      modelsWithReferenceDeclarations,
      modelsWithoutReferenceDeclarations: state.models.length - modelsWithReferenceDeclarations,
      rowsWithModelCapacityDeclarations: rows.filter((row) => row.keys.some((entry) => entry.capacitySource === "模型声明")).length,
    },
    rows,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = outputPath(process.argv.slice(2));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(buildReferenceKeyCensus(), null, 2)}\n`, "utf8");
  console.log(destination);
}
