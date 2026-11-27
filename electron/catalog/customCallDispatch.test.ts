import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CANVAS_TEST_PROJECT as projectId, setupCanvasShots } from "../capabilityCore/canvasShotTestUtils";
import { lazyCanvasTransport } from "../capabilityCore/canvasTransportProvider";
import { installFetchCapture } from "../parity/generationParityTestUtils";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import { envelopeRefFor } from "../productionRun/productionGenerationBinding";
import { buildWorld, type World } from "../../tests/world";
import { makeApiKeyRecordFromPlain } from "./secrets";

vi.mock("electron", async (original) => ({
  ...await original<typeof import("electron")>(),
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() },
}));

let world: World;
let restoreWorld: () => void;
let upstream: ReturnType<typeof installFetchCapture>;
const vendor = "apimart";
const nodeId = "sample-node";
const host = () => setupCanvasShots({ root: world.rootDir, vendorKey: vendor, transport: lazyCanvasTransport() });

const scriptModel = "nomi-audio";
beforeEach(() => {
  const now = new Date().toISOString();
  world = buildWorld({ projects: [], encryptedApiKeys: { [vendor]: makeApiKeyRecordFromPlain("test-key", vendor, true, now, now) },
    catalog: { models: [{ vendorKey: vendor, modelKey: scriptModel, kind: "audio", enabled: true,
      customCall: { modes: { transcribe: { script: "return await http.post('/transcribe', { prompt })" } } },
    }] },
  });
  restoreWorld = world.activate();
  upstream = installFetchCapture();
});
afterEach(() => {
  upstream.restore();
  restoreWorld();
  world.cleanup();
});

it("posts one MiniMax regeneration when only the requested resolution changes", async () => {
  const h = host();
  const modelKey = "MiniMax-H3-Regeneration";
  const click = (runRecordId: string, resolution: string) => h.runs.submit({
    projectId, nodeId, runRecordId, vendor, senderId: h.senderId, gesture: h.gesture,
    request: { kind: "text_to_video", prompt: "", extras: { modelKey, source_task_id: "parent", resolution } },
  });
  const first = await click("first", "720p");
  expect(await click("next", "1080p")).toMatchObject({ id: first.id });
  expect(upstream.calls.map(({ method, body }) => ({ method, body }))).toEqual([
    { method: "POST", body: { model: modelKey, source_task_id: "parent" } },
  ]);
});

it("materializes a script transcript and replays the same text and receipt after restart", async () => {
  upstream.respondWith(() => ({ status: 200, payload: { text: "blue cloud" } }));
  const h = host();
  const input = { projectId, nodeId, runRecordId: "first", vendor, senderId: h.senderId, gesture: h.gesture,
    request: { kind: "transcribe", prompt: "transcribe this", extras: { modelKey: scriptModel, archetype: { id: "nomi-audio", modeId: "transcribe" }, reference_audio_urls: ["https://fixture.example/audio.mp3"] } } };
  await h.runs.submit(input);
  const online = await h.runs.poll(input);
  expect(online).toMatchObject({ status: "succeeded", raw: { text: "blue cloud", customCall: true,
    choices: [{ message: { role: "assistant", content: "blue cloud" } }] } });
  const run = h.repository.read(projectId, canvasRunIdFor(input.runRecordId))!;
  expect(run).toMatchObject({ status: "completed", jobs: [{ status: "ready" }] });
  const file = path.join(world.rootDir, envelopeRefFor(run.runId, run.jobs[0]!.jobId));
  expect(JSON.parse(fs.readFileSync(file, "utf8")).settledResult).toEqual(online);
  const fresh = host();
  expect(await fresh.runs.poll(input)).toEqual(online);
  expect(await fresh.runs.submit(input)).toEqual(online);
  expect(upstream.calls.map(call => call.method)).toEqual(["POST"]);
});
