import { describe, expect, it } from "vitest";

import type { Mapping } from "./catalog/types";
import { buildProfileTaskResult, usesSynchronousAudioRunner } from "./runtime";

const asyncAudioMapping: Mapping = {
  id: "fixture-async-audio",
  vendorKey: "fixture",
  modelKey: "fixture-music",
  taskKind: "text_to_audio",
  name: "Fixture async music",
  enabled: true,
  create: {
    method: "POST",
    path: "/music/generations",
    response_mapping: { task_id: "data.task_id", status: "data.status" },
  },
  query: {
    method: "GET",
    path: "/music/tasks/{{providerMeta.task_id}}",
    response_mapping: { task_id: "task_id", status: "status", audio_url: "result.music.0.audio_url" },
  },
  statusMapping: { queued: ["submitted", "pending"], running: ["processing"], succeeded: ["completed"], failed: ["failed"] },
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

describe("asynchronous catalog audio", () => {
  it("routes audio mappings with a query operation through generic create/poll", () => {
    expect(usesSynchronousAudioRunner("audio", asyncAudioMapping)).toBe(false);
    expect(usesSynchronousAudioRunner("audio", { ...asyncAudioMapping, query: undefined })).toBe(true);
    expect(usesSynchronousAudioRunner("video", asyncAudioMapping)).toBe(false);
  });

  it("extracts audio_url as an audio asset from a terminal query", async () => {
    const { result } = await buildProfileTaskResult({
      response: {
        task_id: "music-task-1",
        status: "completed",
        result: { music: [{ audio_url: "https://cdn.example/song.mp3" }] },
      },
      mapping: asyncAudioMapping,
      operation: asyncAudioMapping.query!,
      request: { kind: "text_to_audio", prompt: "cinematic score" },
      taskIdFallback: "fallback-task",
      wantedKind: "audio",
    });

    expect(result).toMatchObject({
      id: "music-task-1",
      status: "succeeded",
      assets: [{ type: "audio", url: "https://cdn.example/song.mp3" }],
    });
  });
});
