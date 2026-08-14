import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildProfileHttpRequest } from "./profileHttpRequest";
import { REPLICATE_CURATED_MAPPINGS } from "./replicateModels";
import type { Model, ProfileKind, Vendor } from "./types";
import { buildArchetypeInputParams } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import {
  REPLICATE_MINIMAX_VIDEO_01_ARCHETYPE,
  REPLICATE_NANO_BANANA_ARCHETYPE,
  REPLICATE_QWEN_IMAGE_EDIT_ARCHETYPE,
  REPLICATE_SEEDANCE_1_PRO_ARCHETYPE,
} from "../../src/config/modelArchetypes/replicate";
import type { ModelArchetype } from "../../src/config/modelArchetypes/types";
import { collectAssetUrls, valuesFromMapping } from "../tasks/responseParsing";
import { requestJson } from "../vendor/vendorHttp";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import type { GenerationCanvasNode } from "../../src/workbench/generationCanvas/model/generationCanvasTypes";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function mappingFor(modelKey: string, taskKind: ProfileKind) {
  const mapping = REPLICATE_CURATED_MAPPINGS.find((candidate) => candidate.modelKey === modelKey && candidate.taskKind === taskKind);
  if (!mapping) throw new Error(`missing mapping: ${modelKey}/${taskKind}`);
  return mapping;
}

function model(modelKey: string, kind: "image" | "video"): Model {
  return {
    modelKey,
    vendorKey: "replicate",
    labelZh: modelKey,
    kind,
    enabled: true,
    createdAt: "2026-08-14",
    updatedAt: "2026-08-14",
  };
}

function vendor(baseUrlHint = "https://api.replicate.com/v1"): Vendor {
  return {
    key: "replicate",
    name: "Replicate",
    enabled: true,
    baseUrlHint,
    authType: "bearer",
    authHeader: "Authorization",
    createdAt: "2026-08-14",
    updatedAt: "2026-08-14",
  };
}

function requestFor(
  archetype: ModelArchetype,
  modeId: string,
  kind: ProfileKind,
  params: Record<string, unknown>,
  references: Parameters<typeof buildArchetypeInputParams>[2] = {},
) {
  const meta = { archetype: { id: archetype.id, modeId } };
  return {
    kind,
    prompt: "测试提示词",
    extras: {
      ...params,
      archetypeInput: buildArchetypeInputParams(meta, archetype, references),
    },
  };
}

function build(modelKey: string, kind: "image" | "video", taskKind: ProfileKind, request: ReturnType<typeof requestFor>, baseUrl?: string) {
  const mapping = mappingFor(modelKey, taskKind);
  return buildProfileHttpRequest({
    vendor: vendor(baseUrl),
    model: model(modelKey, kind),
    apiKey: "r8_test_key",
    request,
    operation: mapping.create,
  });
}

describe("Replicate 请求塑形", () => {
  it("Nano Banana 多参考图保持数组和顺序", () => {
    const request = requestFor(
      REPLICATE_NANO_BANANA_ARCHETYPE,
      "edit",
      "image_edit",
      { aspect_ratio: "16:9", output_format: "png" },
      { referenceImages: ["https://cdn/character.png", "https://cdn/style.png", "https://cdn/product.png"] },
    );
    const built = build("google/nano-banana", "image", "image_edit", request);
    expect(built.url).toBe("https://api.replicate.com/v1/models/google/nano-banana/predictions");
    expect(built.body).toEqual({
      input: {
        prompt: "测试提示词",
        image_input: ["https://cdn/character.png", "https://cdn/style.png", "https://cdn/product.png"],
        aspect_ratio: "16:9",
        output_format: "png",
      },
    });
  });

  it("Qwen Image Edit 的单图不会误发成数组", () => {
    const request = requestFor(
      REPLICATE_QWEN_IMAGE_EDIT_ARCHETYPE,
      "edit",
      "image_edit",
      { aspect_ratio: "match_input_image", output_format: "webp", go_fast: true, output_quality: 95 },
      { referenceImages: ["https://cdn/source.png"] },
    );
    const input = (build("qwen/qwen-image-edit", "image", "image_edit", request).body as { input: Record<string, unknown> }).input;
    expect(input.image).toBe("https://cdn/source.png");
    expect(Array.isArray(input.image)).toBe(false);
  });

  it("MiniMax 首帧与角色参考按模式互斥，不会同时发出", () => {
    const firstFrame = requestFor(
      REPLICATE_MINIMAX_VIDEO_01_ARCHETYPE,
      "i2v",
      "image_to_video",
      { prompt_optimizer: true },
      { firstFrameUrl: "https://cdn/first.png", referenceImages: ["https://cdn/should-not-send.png"] },
    );
    const firstInput = (build("minimax/video-01", "video", "image_to_video", firstFrame).body as { input: Record<string, unknown> }).input;
    expect(firstInput.first_frame_image).toBe("https://cdn/first.png");
    expect(firstInput).not.toHaveProperty("subject_reference");

    const subject = requestFor(
      REPLICATE_MINIMAX_VIDEO_01_ARCHETYPE,
      "s2v",
      "image_to_video",
      { prompt_optimizer: false },
      { firstFrameUrl: "https://cdn/should-not-send.png", referenceImages: ["https://cdn/subject.png"] },
    );
    const subjectInput = (build("minimax/video-01", "video", "image_to_video", subject).body as { input: Record<string, unknown> }).input;
    expect(subjectInput.subject_reference).toBe("https://cdn/subject.png");
    expect(subjectInput).not.toHaveProperty("first_frame_image");
  });

  it("Seedance 首尾帧保留语义和参数类型", () => {
    const request = requestFor(
      REPLICATE_SEEDANCE_1_PRO_ARCHETYPE,
      "firstlast",
      "image_to_video",
      { duration: 8, resolution: "1080p", fps: 24, camera_fixed: false },
      { firstFrameUrl: "https://cdn/first.png", lastFrameUrl: "https://cdn/last.png" },
    );
    const input = (build("bytedance/seedance-1-pro", "video", "image_to_video", request).body as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({
      image: "https://cdn/first.png",
      last_frame_image: "https://cdn/last.png",
      duration: 8,
      resolution: "1080p",
      fps: 24,
      camera_fixed: false,
    });
  });

  it("Seedance 传图模式不发送会被上游忽略的 aspect_ratio", () => {
    const request = requestFor(
      REPLICATE_SEEDANCE_1_PRO_ARCHETYPE,
      "i2v",
      "image_to_video",
      { duration: 5, resolution: "1080p", aspect_ratio: "9:16", fps: 60, camera_fixed: false },
      { firstFrameUrl: "https://cdn/first.png" },
    );
    const input = (build("bytedance/seedance-1-pro", "video", "image_to_video", request).body as { input: Record<string, unknown> }).input;
    expect(input).not.toHaveProperty("aspect_ratio");
    expect(input.fps).toBe(24);
  });

  it("任一必填参考槽缺失都会在构建付费请求前失败", () => {
    const metaKeyByKind: Record<string, string> = {
      first_frame: "firstFrameUrl",
      last_frame: "lastFrameUrl",
      image_ref: "referenceImageUrls",
      video_ref: "referenceVideoUrls",
      audio_ref: "referenceAudioUrls",
      source_video: "sourceVideoUrl",
    };
    const valueByKind: Record<string, unknown> = {
      first_frame: "https://cdn/first.png",
      last_frame: "https://cdn/last.png",
      image_ref: ["https://cdn/reference.png"],
      video_ref: ["https://cdn/reference.mp4"],
      audio_ref: ["https://cdn/reference.mp3"],
      source_video: "https://cdn/source.mp4",
    };

    for (const contract of [
      REPLICATE_QWEN_IMAGE_EDIT_ARCHETYPE,
      REPLICATE_NANO_BANANA_ARCHETYPE,
      REPLICATE_MINIMAX_VIDEO_01_ARCHETYPE,
      REPLICATE_SEEDANCE_1_PRO_ARCHETYPE,
    ]) {
      const modelKey = contract.identifierPatterns[0];
      for (const mode of contract.modes) {
        const required = mode.slots.filter((slot) => slot.min > 0);
        for (const missingSlot of required) {
          const meta: Record<string, unknown> = {
            modelKey,
            modelVendor: "replicate",
            vendor: "replicate",
            archetype: { id: contract.id, modeId: mode.id },
          };
          for (const slot of required) {
            if (slot === missingSlot) continue;
            meta[metaKeyByKind[slot.kind]] = valueByKind[slot.kind];
          }
          const node: GenerationCanvasNode = {
            id: `${contract.id}-${mode.id}`,
            kind: contract.kind,
            title: "",
            position: { x: 0, y: 0 },
            prompt: "测试提示词",
            meta,
          };
          expect(
            () => buildCatalogTaskRequest(node),
            `${contract.id}/${mode.id} missing ${missingSlot.kind}`,
          ).toThrow(missingSlot.label);
        }
      }
    }
  });
});

describe("本地假 Replicate HTTP 往返", () => {
  it("真实发出 create/query 请求，并解析异步多资产 output", async () => {
    const received: Array<{ method: string; url: string; authorization: string; prefer: string; body?: unknown }> = [];
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      received.push({
        method: req.method || "",
        url: req.url || "",
        authorization: String(req.headers.authorization || ""),
        prefer: String(req.headers.prefer || ""),
        ...(raw ? { body: JSON.parse(raw) } : {}),
      });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST") {
        res.end(JSON.stringify({ id: "pred-1", status: "starting", output: null }));
        return;
      }
      res.end(JSON.stringify({ id: "pred-1", status: "succeeded", output: ["https://cdn/out-1.png", "https://cdn/out-2.png"] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    const taskRequest = requestFor(
      REPLICATE_NANO_BANANA_ARCHETYPE,
      "edit",
      "image_edit",
      { aspect_ratio: "1:1", output_format: "jpg" },
      { referenceImages: ["https://cdn/a.png", "https://cdn/b.png"] },
    );
    const createMapping = mappingFor("google/nano-banana", "image_edit");
    const builtCreate = build("google/nano-banana", "image", "image_edit", taskRequest, baseUrl);
    const createResponse = await requestJson(vendor(baseUrl), "r8_test_key", builtCreate.method, builtCreate.url, builtCreate.headers, builtCreate.query, builtCreate.body);
    expect(createResponse).toMatchObject({ id: "pred-1", status: "starting" });

    const builtQuery = buildProfileHttpRequest({
      vendor: vendor(baseUrl),
      model: model("google/nano-banana", "image"),
      apiKey: "r8_test_key",
      request: taskRequest,
      operation: createMapping.query,
      providerMeta: { task_id: "pred-1" },
    });
    const queryResponse = await requestJson(vendor(baseUrl), "r8_test_key", builtQuery.method, builtQuery.url, builtQuery.headers, builtQuery.query, builtQuery.body);
    const mapped = valuesFromMapping(queryResponse, createMapping.query.response_mapping ?? null, "assets");

    expect(received).toEqual([
      {
        method: "POST",
        url: "/v1/models/google/nano-banana/predictions",
        authorization: "Bearer r8_test_key",
        prefer: "wait=60",
        body: {
          input: {
            prompt: "测试提示词",
            image_input: ["https://cdn/a.png", "https://cdn/b.png"],
            aspect_ratio: "1:1",
            output_format: "jpg",
          },
        },
      },
      {
        method: "GET",
        url: "/v1/predictions/pred-1",
        authorization: "Bearer r8_test_key",
        prefer: "",
      },
    ]);
    expect(mapped.flatMap(collectAssetUrls)).toEqual(["https://cdn/out-1.png", "https://cdn/out-2.png"]);
  });
});
