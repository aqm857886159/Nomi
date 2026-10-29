#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildTemplateContext, renderTemplateValue } from "../electron/ai/requestPipeline";
import { bodyReferencedParamKeys } from "../electron/catalog/paramTranslate";
import { bodyReferenceSupport } from "../electron/catalog/referenceReachability";
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins";
import { imageEditGuardError, applyHeadlessParamDefaults, taskTemplateParams } from "../electron/catalog/taskParams";
import { referenceKeyDeclarationFor } from "../electron/shared/modelArchetypes/referenceKeys";
import type { CatalogState, Mapping } from "../electron/catalog/types";

type Family = "image" | "video" | "audio";

type Case = { id: string; family: Family; falseKeys: string[] };

const CASES: readonly Case[] = [
  { id: "seed-kie-happyhorse-text_to_video", family: "audio", falseKeys: ["audio_setting"] },
  { id: "seed-kie-wan3-0-text_to_video", family: "audio", falseKeys: ["audio"] },
  { id: "seed-kie-wan3-0-image_to_video", family: "audio", falseKeys: ["audio"] },
  { id: "seed-apimart-kling-3.0-text_to_video", family: "audio", falseKeys: ["audio"] },
  { id: "seed-apimart-kling-3.0-image_to_video", family: "audio", falseKeys: ["audio"] },
  { id: "seed-apimart-wan-3.0-apimart-text_to_video", family: "audio", falseKeys: ["audio"] },
  { id: "seed-apimart-wan-3.0-apimart-image_to_video", family: "audio", falseKeys: ["audio"] },
  { id: "seed-apimart-nomi-audio-text_to_audio", family: "audio", falseKeys: ["voice"] },
  { id: "seed-agnes-video-v2-text_to_video", family: "video", falseKeys: ["num_frames", "frame_rate"] },
  { id: "seed-agnes-video-v2-image_to_video", family: "video", falseKeys: ["num_frames", "frame_rate"] },
  { id: "seed-agnes-video-2.5-text_to_video", family: "video", falseKeys: ["video_start_seconds", "video_require_audio"] },
  { id: "seed-agnes-video-2.5-image_to_video", family: "video", falseKeys: ["video_start_seconds", "video_require_audio"] },
  { id: "seed-rh-seedance-global-t2v", family: "audio", falseKeys: ["generateAudio"] },
  { id: "seed-rh-seedance-global-i2v", family: "audio", falseKeys: ["generateAudio"] },
  { id: "seed-rh-veo31-t2v", family: "audio", falseKeys: ["generateAudio"] },
  { id: "seed-rh-veo31-i2v", family: "audio", falseKeys: ["generateAudio"] },
  { id: "seed-minimax-speech-2.8-hd-text_to_audio", family: "audio", falseKeys: ["voice_id"] },
  { id: "seed-minimax-speech-2.8-turbo-text_to_audio", family: "audio", falseKeys: ["voice_id"] },
  { id: "seed-fal-fal-ai-nano-banana-2-t2i", family: "image", falseKeys: ["num_images"] },
  { id: "seed-fal-fal-ai-nano-banana-2-edit-edit", family: "image", falseKeys: ["num_images"] },
  { id: "seed-fal-openai-gpt-image-2-t2i", family: "image", falseKeys: ["image_size", "num_images"] },
  { id: "seed-fal-openai-gpt-image-2-edit-i2i", family: "image", falseKeys: ["image_size", "num_images"] },
  { id: "seed-fal-bytedance-seedream-v5-pro-text-to-image-t2i", family: "image", falseKeys: ["image_size", "num_images"] },
  { id: "seed-fal-bytedance-seedream-v5-pro-edit-edit", family: "image", falseKeys: ["image_size", "num_images"] },
  { id: "seed-runway-eleven_multilingual_v2-speech", family: "audio", falseKeys: ["voice_preset_id"] },
  { id: "seed-runway-eleven_v3-speech", family: "audio", falseKeys: ["voice_preset_id"] },
];

const REFS: Record<Family, string[]> = {
  image: ["https://loopback.invalid/reference-image.png"],
  video: ["https://loopback.invalid/reference-video.mp4"],
  audio: ["https://loopback.invalid/reference-audio.mp3"],
};

function controlValue(key: string): unknown {
  if (/^(audio|generateAudio|video_require_audio)$/i.test(key)) return false;
  if (/^(num_images|num_frames)$/i.test(key)) return 3;
  if (/^(frame_rate|video_start_seconds)$/i.test(key)) return 24;
  if (/image_size/i.test(key)) return "keep-image-size";
  if (/voice/i.test(key)) return "keep-voice";
  if (/audio_setting/i.test(key)) return "keep-audio-setting";
  return "keep-control";
}

function walkValues(value: unknown, into: Record<string, unknown[]> = {}, key?: string): Record<string, unknown[]> {
  if (key) (into[key] ??= []).push(value);
  if (Array.isArray(value)) for (const item of value) walkValues(item, into, key);
  else if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) walkValues(childValue, into, childKey);
  }
  return into;
}

function mappingFor(state: CatalogState, id: string): Mapping {
  const mapping = state.mappings.find((candidate) => candidate.id === id);
  if (!mapping) throw new Error(`missing seeded mapping: ${id}`);
  return mapping;
}

function referenceExtras(family: Family, falseKeys: string[]): Record<string, unknown> {
  return {
    modelKey: "headless-rehearsal-model",
    ...(family === "image" ? { referenceImages: REFS.image } : {}),
    ...(family === "video" ? { referenceVideoUrls: REFS.video } : {}),
    ...(family === "audio" ? { referenceAudioUrls: REFS.audio } : {}),
    ...Object.fromEntries(falseKeys.map((key) => [key, controlValue(key)])),
  };
}

function fakeUpstreamReceive(body: unknown, received: unknown[]): void {
  received.push(body);
}

export function runRehearsal(): { generatedAt: string; summary: Record<string, number>; cases: unknown[] } {
  const initial: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const { state } = applyBuiltinSeeds(initial, "2026-10-25T00:00:00.000Z");
  const received: unknown[] = [];
  const cases = CASES.map((testCase) => {
    const mapping = mappingFor(state, testCase.id);
    const model = state.models.find((candidate) => candidate.vendorKey === mapping.vendorKey && candidate.modelKey === mapping.modelKey);
    const archetypeId = typeof (model?.meta as Record<string, unknown> | undefined)?.archetypeId === "string"
      ? (model?.meta as Record<string, string>).archetypeId
      : undefined;
    const referenceContext = {
      vendorKey: mapping.vendorKey,
      modelKey: mapping.modelKey,
      modelMeta: model?.meta,
      archetypeId,
      taskKind: mapping.taskKind,
    };
    const bodyKeys = bodyReferencedParamKeys(mapping.create?.body);
    const declaredReferenceKeys = bodyKeys.filter((key) => {
      const declaration = referenceKeyDeclarationFor(key);
      return declaration?.family === testCase.family;
    });
    const support = bodyReferenceSupport(mapping.create?.body, referenceContext);
    const extras = referenceExtras(testCase.family, testCase.falseKeys);
    // 第一闸收的与第三闸（下面的 imageEditGuardError）同一份完整身份（2026-10-27）。
    const merged = applyHeadlessParamDefaults(
      extras,
      referenceContext,
      mapping.create?.defaultParams,
      mapping.create?.body,
    ) ?? {};
    const guardError = imageEditGuardError(
      mapping.taskKind,
      { kind: mapping.taskKind, extras: merged },
      true,
      mapping.modelKey ?? mapping.id,
      mapping.create?.body,
      undefined,
      referenceContext,
    );
    const expectedReject = !support[testCase.family];
    if (expectedReject !== Boolean(guardError)) {
      throw new Error(`${testCase.id}: guard expectedReject=${expectedReject} actual=${Boolean(guardError)}`);
    }
    if (guardError) {
      return {
        id: testCase.id,
        taskKind: mapping.taskKind,
        family: testCase.family,
        declaredReferenceKeys,
        sentCount: 0,
        rejected: true,
        error: guardError,
        controlValues: Object.fromEntries(testCase.falseKeys.map((key) => [key, controlValue(key)])),
      };
    }
    const params = taskTemplateParams({ kind: mapping.taskKind, extras: merged });
    const body = renderTemplateValue(mapping.create?.body, buildTemplateContext({
      request: { prompt: "headless reference rehearsal" },
      params,
      model: {},
      modelKey: mapping.modelKey ?? "headless-rehearsal-model",
      apiKey: "loopback-only",
    }));
    fakeUpstreamReceive(body, received);
    const valuesByKey = walkValues(body);
    for (const key of testCase.falseKeys) {
      const actual = valuesByKey[key] ?? [];
      if (!actual.some((value) => Object.is(value, controlValue(key)))) {
        throw new Error(`${testCase.id}: control ${key} changed: ${JSON.stringify(actual)}`);
      }
      if (actual.some((value) => JSON.stringify(value).includes("loopback.invalid"))) {
        throw new Error(`${testCase.id}: reference leaked into control ${key}`);
      }
    }
    const wireReferenceKeys = Object.keys(valuesByKey).filter((key) => {
      const declaration = referenceKeyDeclarationFor(key);
      return declaration?.family === testCase.family
        && valuesByKey[key].some((value) => JSON.stringify(value).includes("loopback.invalid"));
    });
    if (wireReferenceKeys.length === 0) throw new Error(`${testCase.id}: reference did not reach a declared key`);
    return {
      id: testCase.id,
      taskKind: mapping.taskKind,
      family: testCase.family,
      declaredReferenceKeys,
      wireReferenceKeys,
      sentCount: 1,
      rejected: false,
      requestBody: body,
      controlValues: Object.fromEntries(testCase.falseKeys.map((key) => [key, controlValue(key)])),
    };
  });
  return {
    generatedAt: "2026-10-25T00:00:00.000Z",
    summary: {
      cases: cases.length,
      sent: cases.filter((entry) => entry.sentCount === 1).length,
      rejectedBeforeSend: cases.filter((entry) => entry.rejected).length,
      fakeUpstreamRequests: received.length,
    },
    cases,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = path.resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "docs/evidence/2026-10-25-reference-key-projection/free-rehearsal.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(runRehearsal(), null, 2)}\n`, "utf8");
  console.log(destination);
}
