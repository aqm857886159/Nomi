import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { GenerationProviderObservationError } from "../capabilityCore/generationRuntimeAdapter";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { landedAdmission } from "./landFirstTestUtils";

const roots: string[] = [];
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{
      modelId: "fixture-model",
      modes: ["text-to-image"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

function candidate(): PlanCandidate {
  return {
    candidateId: "candidate-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: "A paper boat on a quiet lake",
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-submit-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null,
    now: () => "2026-08-23T00:00:00.000Z",
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({
    operationId: "op-1",
    projectId: "project-1",
    origin: { host: "semantic-mcp" },
    candidate: planCandidate,
    policy: {
      trustedHosts: ["semantic-mcp"],
      allowedProviders: ["fixture-provider"],
      allowedModels: ["fixture-model"],
      maxSpend: 0,
      maxAttemptsPerJob: 2,
    },
  });
  sealAndApproveProductionGeneration({
    repository,
    projectId: "project-1",
    operationId: "op-1",
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    candidate: planCandidate,
    contract,
    providers: [{
      providerId: "fixture-provider",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      buildRequest: (input) => input,
      submit: async () => ({ providerTaskId: "unused" }),
    }],
    now: "2026-08-23T00:00:00.000Z",
  });
  return { root, repository, contract };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

type Case = { id: string; pair: string; timing: string; lateStatus: string };
const cases = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/generation-lifecycle-cases.json", import.meta.url), "utf8")) as Case[];
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const capture = (promise: Promise<unknown>) => promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error: String(error) }));

it.each(cases)("lifecycle matrix $id", async ({ pair, timing, lateStatus }) => {
  const { root, repository } = setup();
  const input = { projectId: "project-1", operationId: "op-1" };
  const now = () => "2026-08-23T00:03:00.000Z";
  const entered = latch(), release = latch(), peerEntered = latch(), peerRelease = latch(), outputEntered = latch(), outputRelease = latch();
  const isMaterialize = pair === "output-ownership" || pair.includes("materialize") && !pair.startsWith("poll");
  const positive = pair.startsWith("positive");
  let peerStatus = isMaterialize ? "completed" : "processing";
  let peerSource = "initial";
  let firstExtract = true;
  let firstQuery = true;
  const submit = vi.fn(async () => ({ providerTaskId: "task-matrix" }));
  const outputs = (source: string) => ({ outputs: [{ kind: "image" as const, url: `https://cdn.example/${source}.png` }] });
  const materializeOutput = vi.fn(async (_input: { output: { url: string } }) => {
    if (pair === "output-ownership") { outputEntered.resolve(); await outputRelease.promise; }
    return { artifactId: "matrix-artifact", kind: "image" as const, contentHash: "c".repeat(64), projectRelativePath: "assets/generated/matrix.png" };
  });
  const make = (first: boolean) => createProductionGenerationSubmission({
    repository: first ? repository : createProductionRunRepository({ projectDirResolver: () => root, now }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    intentMacKey: "non-secret-fixture", beforeDispatch: () => undefined, now, materializeOutput,
    provider: { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: value => value, submit,
      query: async () => {
        if (first && firstQuery && !positive) { firstQuery = false; entered.resolve(); await release.promise; }
        return { status: first ? lateStatus : peerStatus, raw: { source: first ? "late" : peerSource } };
      },
      materialize: async ({ raw }) => {
        if (!first && pair === "output-ownership") peerEntered.resolve();
        if (!first && !positive && timing !== "materialized" && pair !== "poll-poll" && pair !== "output-ownership") {
          peerEntered.resolve(); await peerRelease.promise;
        }
        if (first && firstExtract && pair !== "output-ownership") {
          firstExtract = false;
          if (!positive) { entered.resolve(); await release.promise; }
          if (lateStatus === "processing") return { outputs: [] };
          if (lateStatus === "failed") throw new Error("late extraction failure");
          if (lateStatus === "unknown") throw new GenerationProviderObservationError("fixture-provider", "materialize");
        }
        return outputs((raw as { source: string }).source);
      },
    },
  });
  const first = make(true), peer = make(false);
  const started = await first.start({ ...input, admission: await landedAdmission(repository, input.projectId, input.operationId) });
  const file = path.join(root, ".nomi/runs/op-1/jobs", started.jobId, "runtime-envelope.json");
  const read = () => repository.read(input.projectId, input.operationId)!;
  const marker = () => { const run = read(); repository.execute(input.projectId, input.operationId, {
    commandId: "concurrent-marker", expectedRevision: run.revision, type: "job.patch", issuedAt: now(),
    payload: { jobId: started.jobId, patch: { metadata: { ...run.jobs[0]!.metadata, concurrentMarker: true } } },
  }); };
  if (!positive || isMaterialize) await peer.poll(input);
  if (pair === "positive-io") {
    await peer.poll(input);
    const reads = vi.spyOn(fs, "readFileSync"), opens = vi.spyOn(fs, "openSync"), writes = vi.spyOn(fs, "renameSync");
    let counts;
    try {
      expect(await first.poll(input)).toMatchObject({ nextAction: "poll" });
      counts = { reads: reads.mock.calls.map(call => String(call[0]).replace(root, "<fixture>")), opens: opens.mock.calls.length, snapshots: writes.mock.calls.length };
      expect(counts.reads.filter(path => path.endsWith("runtime-envelope.json"))).toHaveLength(2);
      expect(counts.opens).toBe(0); expect(counts.snapshots).toBe(0);
    } finally { reads.mockRestore(); opens.mockRestore(); writes.mockRestore(); }
    if (process.env.NOMI_LIFECYCLE_IO_OUT) fs.writeFileSync(process.env.NOMI_LIFECYCLE_IO_OUT, JSON.stringify(counts, null, 2));
    return;
  }
  if (pair === "output-ownership") {
    const a = capture(first.materialize(input)); await outputEntered.promise;
    const b = capture(peer.materialize(input)); await peerEntered.promise;
    marker(); outputRelease.resolve();
    const results = await Promise.all([a, b]);
    for (const result of results) expect.soft(result).toMatchObject({ value: { nextAction: "completed", artifactId: "matrix-artifact" } });
    expect(materializeOutput).toHaveBeenCalledTimes(1);
    expect(read().jobs[0]!.metadata).toMatchObject({ concurrentMarker: true });
    expect(submit).toHaveBeenCalledTimes(1);
    return;
  }
  if (positive) {
    const result = await capture(isMaterialize ? first.materialize(input) : first.poll(input));
    if (isMaterialize && lateStatus !== "completed") {
      expect(result.error).toBeTruthy(); expect(result.error).not.toMatch(/Conflict|revision conflict/);
      expect(materializeOutput).not.toHaveBeenCalled();
    } else {
      const nextAction = isMaterialize ? "completed" : lateStatus === "processing" ? "poll" : lateStatus === "completed" ? "materialize" : "attention";
      expect(result).toMatchObject({ value: { nextAction } });
      expect(JSON.parse(fs.readFileSync(file, "utf8")).lastPoll.status).toBe(isMaterialize ? "completed" : lateStatus);
      expect(materializeOutput).toHaveBeenCalledTimes(isMaterialize ? 1 : 0);
    }
    expect(submit).toHaveBeenCalledTimes(1);
    return;
  }
  const late = capture(isMaterialize ? first.materialize(input) : first.poll(input));
  await entered.promise;
  let other: ReturnType<typeof capture> | undefined;
  if (!(timing === "revision" && pair !== "poll-materialize")) {
    peerStatus = "completed"; peerSource = "winner"; await peer.poll(input);
  } else if (pair === "poll-poll") { await peer.poll(input); }
  if (pair !== "poll-poll") {
    other = capture(peer.materialize(input));
    if (timing === "materialized") await other;
    else await peerEntered.promise;
  } else if (timing === "materialized") { await peer.materialize(input); }
  if (timing === "revision") marker();
  const beforeBytes = fs.readFileSync(file, "utf8"), beforeRevision = read().revision, beforeOutputs = materializeOutput.mock.calls.length;
  const writes = vi.spyOn(fs, "renameSync"), opens = vi.spyOn(fs, "openSync"), lockWrites = vi.spyOn(fs, "writeSync");
  try {
    release.resolve();
    const result = await late;
    if (isMaterialize && timing === "revision" && lateStatus !== "completed") {
      expect.soft(result.error).toBeTruthy(); expect.soft(result.error).not.toMatch(/Conflict|revision conflict/);
    } else {
      const nextAction = isMaterialize ? "completed" : pair === "poll-poll" && timing === "revision"
        ? lateStatus === "processing" ? "poll" : lateStatus === "completed" ? "materialize" : "attention" : "materialize";
      expect.soft(result).toMatchObject({ value: { nextAction } });
    }
    if (timing === "materialized" || (timing === "completed" && !isMaterialize)) {
      expect.soft(fs.readFileSync(file, "utf8")).toBe(beforeBytes);
      expect.soft(read().revision).toBe(beforeRevision);
      expect.soft(writes).not.toHaveBeenCalled();
      expect.soft(materializeOutput.mock.calls.length).toBe(beforeOutputs);
    }
    if (timing === "materialized") { expect.soft(opens).not.toHaveBeenCalled(); expect.soft(lockWrites).not.toHaveBeenCalled(); }
    if (timing === "revision") expect.soft(read().jobs[0]!.metadata).toMatchObject({ concurrentMarker: true });
    if (timing === "completed") expect.soft(JSON.parse(fs.readFileSync(file, "utf8")).lastPoll.raw.source).toBe("winner");
    if (isMaterialize && timing === "completed") expect.soft(materializeOutput.mock.calls[0]?.[0].output.url).toContain("winner");
  } finally { writes.mockRestore(); opens.mockRestore(); lockWrites.mockRestore(); peerRelease.resolve(); }
  const parked = isMaterialize && timing === "revision" && ["processing", "unknown"].includes(lateStatus);
  if (other) {
    const peerResult = await other;
    if (parked) { expect.soft(peerResult.error).toContain("GenerationMaterializationError"); expect.soft(read().jobs[0]!.status).toBe("needs_attention"); }
    else { expect.soft(peerResult.error).toBeUndefined(); expect.soft(peerResult).toMatchObject({ value: { nextAction: "completed" } }); }
  }
  expect(submit).toHaveBeenCalledTimes(1);
  expect(materializeOutput).toHaveBeenCalledTimes(parked ? 0 : pair === "poll-poll" ? timing === "materialized" ? 1 : 0 : 1);
});
