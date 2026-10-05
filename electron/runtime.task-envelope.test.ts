import { describe, expect, it } from "vitest";

import type { TaskRequest } from "./runtime";

describe("RuntimeTask execution binding", () => {
  it("carries the same provider-neutral binding regardless of task mode", () => {
    const request: TaskRequest = {
      kind: "text_to_image",
      prompt: "a red fox",
      extras: {
        mode: "image-to-image",
        executionBinding: {
          immutableProjectUuid: "project-uuid-1",
          projectGeneration: 4,
          runId: "run-1",
          shotId: "shot-1",
          contractHash: "a".repeat(64),
          runtimeTaskId: "task-1",
          providerNamespace: "provider.image",
          providerIdempotencyKey: "run-1:shot-1:attempt-1",
          requestFingerprint: "b".repeat(64),
          runtimeEnvelopeRef: ".nomi/runs/run-1/envelopes/task-1.json",
          fencingEpoch: 2,
        },
      },
    };
    expect(request.extras?.executionBinding).toMatchObject({ runId: "run-1", contractHash: "a".repeat(64) });
  });
});
