/**
 * 一次运行给几份，结果映射就读几份（docs/engineering/direction-checks/2026-11-09-multi-result-landing.md）。
 *
 * 复盘时用真实内置目录读四份假响应：newapi 4、Higgsfield 1、Runway query 1 / result 4、APIMart 图片 1、Suno 1——
 * 同样四张，换一家、换一个阶段就少。判据是「同一笔上游给四份有效产物，读出四份」，不看现在的读法怎么写。
 *
 * 三层：
 *   1. 复盘那六组（逐家、逐阶段），两台引擎（readTaskResponse / readMaterializationOutputs）都读出四份、产物号不撞；
 *   2. 按目录枚举：内置目录的每一条映射、每一个阶段、每一条产物路径，按路径本身造四份响应，都读出四份；
 *   3. 老用户存下的目录（向导 / Agent 接入 / 旧内置，升级时不会被改写的那些）原样读，同样四份。
 * 空集、媒体类型、回显三道校验照旧：读整张列表不等于什么地址都收。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readMaterializationOutputs } from "../capabilityCore/apimartGenerationOutputs";
import { readTaskResponse, type ExpectedMediaKind } from "../tasks/taskResultReading";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";
import { APIMART_IMAGE_QUERY_OP } from "./apimartVendor";
import { HIGGSFIELD_IMAGE_QUERY_OP } from "./higgsfieldVendor";
import { NEWAPI_IMAGE_CREATE_OP } from "./newapiTransport";
import { runwayImagePoll, runwayImageResult } from "./runwayShared";
import { applyBuiltinSeeds } from "./seedBuiltins";
import type { CatalogState, HttpOperation, Mapping } from "./types";

type JsonRecord = Record<string, unknown>;

const OUTPUT_KEYS = ["assets", "image_url", "video_url", "audio_url", "model_url"] as const;
const KIND_OF_KEY: Record<(typeof OUTPUT_KEYS)[number], ExpectedMediaKind | null> = {
  assets: null, image_url: "image", video_url: "video", audio_url: "audio", model_url: "model3d",
};
const EXTENSION: Record<ExpectedMediaKind, string> = { image: "png", video: "mp4", audio: "mp3", model3d: "glb" };

const urls = (count: number, ext: string, tag = "fixture") => Array.from({ length: count }, (_, i) => `https://${tag}.invalid/out-${i}.${ext}`);

describe("复盘那六组：同一笔给四份，两台引擎都读出四份", () => {
  const image = urls(4, "png");
  const songs = urls(2, "mp3");
  const suno = APIMART_AUDIO_MODELS.find((model) => model.modelKey === "suno-v5.5")!.mappings[0]!.query!;
  const rows: Array<[string, HttpOperation, unknown, ExpectedMediaKind, string[]]> = [
    ["newapi · create", NEWAPI_IMAGE_CREATE_OP, { created: 1, data: image.map((url) => ({ url })) }, "image", image],
    ["Higgsfield · query", HIGGSFIELD_IMAGE_QUERY_OP, { status: "completed", images: image.map((url) => ({ url })) }, "image", image],
    ["Runway · query", runwayImagePoll, { id: "task-1", status: "SUCCEEDED", output: image }, "image", image],
    ["Runway · result", runwayImageResult, { id: "task-1", status: "SUCCEEDED", output: image }, "image", image],
    ["APIMart 图片 · query", APIMART_IMAGE_QUERY_OP, { code: 200, data: { status: "completed", result: { images: image.map((url) => ({ url: [url] })) } } }, "image", image],
    ["Suno · query（一次两首）", suno, { code: 200, data: { status: "completed", result: { music: songs.map((audio_url, i) => ({ id: `song-${i}`, audio_url })) } } }, "audio", songs],
    ["Suno · query（复盘的四份判据）", suno, { code: 200, data: { status: "completed", result: { music: urls(4, "mp3").map((audio_url) => ({ audio_url })) } } }, "audio", urls(4, "mp3")],
  ];

  it.each(rows)("%s", (_name, op, response, kind, expected) => {
    const mapping = op.response_mapping as JsonRecord;
    const engineA = readTaskResponse({ response, responseMapping: mapping, statusMapping: undefined, wantedKind: kind });
    expect(engineA.assetUrls).toEqual(expected);
    expect(engineA.rule).toBe("contract");
    const engineB = readMaterializationOutputs(response, { responseMapping: mapping }, kind, new Set());
    expect(engineB.map((output) => output.url)).toEqual(expected);
    const ids = engineB.map((output) => output.providerOutputId);
    expect(new Set(ids).size, `provider output ids collide: ${ids.join(", ")}`).toBe(expected.length);
  });

  it("一张也照旧：N=1 读出的地址、产物号和以前一样", () => {
    const one = urls(1, "png");
    const reading = readMaterializationOutputs({ code: 200, data: { status: "completed", result: { images: [{ url: one }] } } },
      { responseMapping: APIMART_IMAGE_QUERY_OP.response_mapping as JsonRecord }, "image", new Set());
    expect(reading).toEqual([{ kind: "image", url: one[0], providerOutputId: "image-1" }]);
  });

  it("空集、媒体类型、回显三道筛照旧：四份里混进参考图回显和一张错类型的，只收剩下的", () => {
    const echo = "https://ref.invalid/reference.png";
    const response = { status: "SUCCEEDED", output: [image[0], echo, "https://fixture.invalid/wrong.mp4", image[1]] };
    const reading = readTaskResponse({ response, responseMapping: runwayImagePoll.response_mapping as JsonRecord, statusMapping: undefined, wantedKind: "image", echoUrls: new Set([echo]) });
    expect(reading.assetUrls).toEqual([image[0], image[1]]);
    const empty = readTaskResponse({ response: { status: "SUCCEEDED", output: [] }, responseMapping: runwayImagePoll.response_mapping as JsonRecord, statusMapping: undefined, wantedKind: "image" });
    expect(empty.assetUrls).toEqual([]);
  });

  it("同一笔里重复的地址只算一份；一项里 url 是数组时每个地址各是一份，产物号不撞", () => {
    const dup = readTaskResponse({ response: { output: [image[0], image[0], image[1], image[2]] }, responseMapping: runwayImagePoll.response_mapping as JsonRecord, statusMapping: undefined, wantedKind: "image" });
    expect(dup.assetUrls).toEqual([image[0], image[1], image[2]]);
    const raw = { data: { status: "completed", result: { images: [{ url: [image[0], image[1]] }, { url: [image[2]] }, { id: "image-1", url: [image[3]] }] } } };
    const outputs = readMaterializationOutputs(raw, { responseMapping: APIMART_IMAGE_QUERY_OP.response_mapping as JsonRecord }, "image", new Set());
    expect(outputs.map((output) => output.url)).toEqual(image);
    expect(new Set(outputs.map((output) => output.providerOutputId)).size).toBe(4);
  });
});

/**
 * 按一条产物路径本身造一份「上游给了 n 份」的响应：路径上第一处列表（数字下标或 `[*]`）放 n 项，其余列表放一项；
 * 路径上没有列表的（单个字段），字段值就是 n 个地址的数组。
 */
function responseForPath(expression: string, values: string[]): unknown {
  const parts = expression.split(".").map((part) => part.trim()).filter(Boolean);
  const build = (index: number, value: string | null, expanded: boolean): unknown => {
    if (index === parts.length) return value ?? values;
    const part = parts[index]!;
    const isIndex = /^\d+$/.test(part);
    const wildcard = part.endsWith("[*]");
    const key = wildcard ? part.slice(0, -3) : part;
    if (isIndex || wildcard) {
      const items = expanded ? [build(index + 1, value, true)] : values.map((item) => build(index + 1, item, true));
      const list = isIndex ? [...Array.from({ length: Number(part) }, () => items[0]), ...items] : items;
      return isIndex || !key ? list : { [key]: list };
    }
    return { [key]: build(index + 1, value, expanded) };
  };
  return build(0, null, false);
}

type PathRow = { where: string; vendor: string; stage: string; key: (typeof OUTPUT_KEYS)[number]; expression: string; mapping: JsonRecord; kind: ExpectedMediaKind };

function outputPathRows(where: string, state: Pick<CatalogState, "mappings" | "models">): PathRow[] {
  const rows: PathRow[] = [];
  for (const mapping of state.mappings as Mapping[]) {
    const model = state.models.find((row) => row.vendorKey === mapping.vendorKey && row.modelKey === mapping.modelKey);
    for (const stage of ["create", "query", "result"] as const) {
      const op = (mapping as unknown as Record<string, HttpOperation | undefined>)[stage];
      if (!op || op.mediaResponse || !op.response_mapping || typeof op.response_mapping !== "object") continue;
      const responseMapping = op.response_mapping as JsonRecord;
      for (const key of OUTPUT_KEYS) {
        const raw = responseMapping[key];
        const expressions = (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
        const kind = KIND_OF_KEY[key] ?? (["image", "video", "audio", "model3d"].includes(String(model?.kind)) ? model!.kind as ExpectedMediaKind : "image");
        for (const expression of expressions) {
          rows.push({ where, vendor: mapping.vendorKey, stage: `${mapping.id} · ${stage}`, key, expression, mapping: responseMapping, kind });
        }
      }
    }
  }
  return rows;
}

function expectFourRead(row: PathRow) {
  const four = urls(4, EXTENSION[row.kind], row.vendor.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "vendor");
  const response = responseForPath(row.expression, four);
  const reading = readTaskResponse({ response, responseMapping: row.mapping, statusMapping: undefined, wantedKind: row.kind });
  expect(reading.assetUrls, `${row.where} ${row.vendor} ${row.stage} ${row.key}=${row.expression}`).toEqual(four);
}

describe("按目录枚举：内置目录每一条产物路径，一笔四份都读出四份", () => {
  const { state } = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-11-09");
  const rows = outputPathRows("builtin", state);

  it("目录里确实有带数字下标的产物路径（这些就是以前「只取第一份」的位置）", () => {
    const indexed = rows.filter((row) => /(^|\.)\d+(\.|$)/.test(row.expression));
    expect(new Set(indexed.map((row) => row.vendor)).size).toBeGreaterThanOrEqual(8);
    expect(indexed.length).toBeGreaterThanOrEqual(20);
  });

  it.each(rows.map((row) => [`${row.vendor} · ${row.stage} · ${row.key}=${row.expression}`, row] as const))("%s", (_name, row) => {
    expectFourRead(row);
  });
});

describe("老用户存下的目录：升级不改写的声明照样读出四份", () => {
  const root = fileURLToPath(new URL("../../tests/fixtures/old-user-data/", import.meta.url));
  const catalogs = ["catalogs", "curated"].flatMap((group) => fs.readdirSync(path.join(root, group))
    .map((name) => path.join(group, name, "model-catalog.json"))
    .filter((relative) => fs.existsSync(path.join(root, relative))));

  it("夹具都在（v0.24.1 向导接的中转、v0.24.1 APIMart 旧内置都在里面）", () => {
    expect(catalogs).toEqual(expect.arrayContaining(["catalogs/v0.24.1-wizard/model-catalog.json", "curated/v0.24.1-apimart/model-catalog.json"]));
  });

  const rows = catalogs.flatMap((relative) => outputPathRows(relative, JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")) as CatalogState));
  it.each(rows.map((row) => [`${row.where} · ${row.vendor} · ${row.stage} · ${row.key}=${row.expression}`, row] as const))("%s", (_name, row) => {
    expectFourRead(row);
  });

  it("v0.24.1 向导接的 opaque-image-x 改图：存下的是 choices.0.message.images.0.url，上游一条回四张 → 四张", () => {
    const state = JSON.parse(fs.readFileSync(path.join(root, "catalogs/v0.24.1-wizard/model-catalog.json"), "utf8")) as CatalogState;
    const edit = state.mappings.find((row) => row.modelKey === "opaque-image-x" && row.taskKind === "image_edit")!;
    expect(edit.create.response_mapping).toEqual({ image_url: "choices.0.message.images.0.url" });
    const four = urls(4, "png");
    const oneChoice = { choices: [{ index: 0, message: { role: "assistant", content: "", images: four.map((url) => ({ type: "image_url", url })) } }] };
    const perChoice = { choices: four.map((url, index) => ({ index, message: { role: "assistant", content: "", images: [{ url }] } })) };
    for (const response of [oneChoice, perChoice]) {
      expect(readTaskResponse({ response, responseMapping: edit.create.response_mapping as JsonRecord, statusMapping: undefined, wantedKind: "image" }).assetUrls).toEqual(four);
    }
  });

  it("v0.24.1 APIMart 旧内置：升级对账后映射是代码里的那份，读出四份；没对账的旧声明原样读也是四份", () => {
    const relative = "curated/v0.24.1-apimart/model-catalog.json";
    const before = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")) as CatalogState;
    const oldImage = before.mappings.find((row) => row.vendorKey === "apimart" && JSON.stringify(row.query?.response_mapping ?? {}).includes("images.0.url"));
    expect(oldImage, "the old release persisted a first-item image path").toBeTruthy();
    const { state } = applyBuiltinSeeds(structuredClone(before), "2026-11-09");
    const upgraded = state.mappings.find((row) => row.id === oldImage!.id)!;
    for (const mapping of [oldImage!, upgraded]) {
      const four = urls(4, "png");
      const response = { code: 200, data: { status: "completed", result: { images: four.map((url) => ({ url: [url] })) } } };
      expect(readTaskResponse({ response, responseMapping: mapping.query!.response_mapping as JsonRecord, statusMapping: undefined, wantedKind: "image" }).assetUrls).toEqual(four);
    }
  });
});
