import { describe, expect, it, vi } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import { compileExecutionContract, type ExecutionContractV1, type PlanCandidate } from "./executionContract";
import {
  assertGenerationProviderCapabilities,
  GenerationProviderCapabilityError,
  GenerationProviderRequestError,
  createGenerationRuntimeAdapter,
  resolveExecutionContract,
  type GenerationProvider,
  type GenerationProviderRequestInputV1,
} from "./generationRuntimeAdapter";
import type { ModuleManifest } from "./moduleManifest";
import { createProductionExecutionBinding } from "../productionRun/productionExecutionBinding";

const manifest: ModuleManifest = {
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image", "video"],
  modes: ["text-to-image", "text-to-video"],
  parameterSchema: { promptStrength: { type: "number" } },
  assetInputSchema: {},
  providers: [
    {
      providerId: "provider.image",
      models: [{
        modelId: "model.image.v1",
        modes: ["text-to-image"],
        parameterSchema: { aspectRatio: { type: "string" } },
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      }],
    },
    {
      providerId: "provider.video",
      models: [{
        modelId: "model.video.v1",
        modes: ["text-to-video"],
        parameterSchema: { duration: { type: "number" } },
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      }],
    },
  ],
};

const registry = createModuleRegistry([manifest]);
function bindingFor(providerNamespace: string, contractHash: string) {
  return createProductionExecutionBinding({
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 4,
    runId: "run-1",
    shotId: "shot-1",
    contractHash,
    runtimeTaskId: "task-1",
    providerNamespace,
    providerIdempotencyKey: "run-1:shot-1:attempt-1",
    requestFingerprint: "b".repeat(64),
    runtimeEnvelopeRef: ".nomi/runs/run-1/envelopes/task-1.json",
    fencingEpoch: 2,
  });
}

function contract(providerId: string, modelId: string, mode: string, parameters: Record<string, unknown>): ExecutionContractV1 {
  const candidate: PlanCandidate = {
    candidateId: "candidate-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId,
    modelId,
    mode,
    prompt: "a red fox",
    parameters,
    references: [],
  };
  return compileExecutionContract(candidate, registry);
}

describe("GenerationRuntimeAdapter", () => {
  it("prepares an exact provider payload hash before submission and verifies it again at submit", async () => {
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "16:9" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    const submit = vi.fn(async () => ({ providerTaskId: "image-task-authorized" }));
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      buildRequest: (input) => ({ model: input.modelId, prompt: input.prompt, ratio: input.parameters.aspectRatio }),
      submit,
    }] });

    const prepared = adapter.prepare({ contract: imageContract, binding });
    await expect(adapter.submit({
      contract: imageContract,
      binding,
      expectedProviderRequestHash: prepared.providerRequestHash,
    })).resolves.toMatchObject({ providerTaskId: "image-task-authorized", providerRequestHash: prepared.providerRequestHash });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("fails closed when buildRequest is not deterministic", () => {
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "16:9" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    let nonce = 0;
    const submit = vi.fn();
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      buildRequest: () => ({ nonce: ++nonce }),
      submit,
    }] });

    expect(() => adapter.prepare({ contract: imageContract, binding })).toThrow(GenerationProviderRequestError);
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit when the actual provider payload differs from the approved hash", async () => {
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "16:9" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    const submit = vi.fn();
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      buildRequest: (input) => ({ model: input.modelId, prompt: input.prompt }),
      submit,
    }] });

    await expect(adapter.submit({ contract: imageContract, binding, expectedProviderRequestHash: "0".repeat(64) })).rejects.toThrow(
      "Provider wire payload no longer matches",
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit without the approved provider payload hash", async () => {
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "16:9" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    const submit = vi.fn();
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      buildRequest: (input) => input,
      submit,
    }] });

    // @ts-expect-error The provider payload hash is a required production authority.
    await expect(adapter.submit({ contract: imageContract, binding })).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it("maps two different provider profiles without provider-specific branches in the adapter", async () => {
    const imageSubmit = vi.fn(async (request: unknown, _idempotencyKey: string) => ({ providerTaskId: "image-task-1", raw: request }));
    const videoSubmit = vi.fn(async (request: unknown, _idempotencyKey: string) => ({ providerTaskId: "video-task-1", raw: request }));
    const adapter = createGenerationRuntimeAdapter({
      providers: [
        {
          providerId: "provider.image",
          capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
          buildRequest: (input) => ({ endpointShape: "image", model: input.modelId, prompt: input.prompt, aspectRatio: input.parameters.aspectRatio }),
          submit: imageSubmit,
        },
        {
          providerId: "provider.video",
          capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
          buildRequest: (input) => ({ endpointShape: "video", model: input.modelId, prompt: input.prompt, duration: input.parameters.duration }),
          submit: videoSubmit,
        },
      ],
    });

    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "16:9" });
    const videoContract = contract("provider.video", "model.video.v1", "text-to-video", { duration: 5 });
    const imageBinding = bindingFor("provider.image", imageContract.contractHash);
    const videoBinding = bindingFor("provider.video", videoContract.contractHash);
    const imagePrepared = adapter.prepare({ contract: imageContract, binding: imageBinding });
    const videoPrepared = adapter.prepare({ contract: videoContract, binding: videoBinding });
    await expect(adapter.submit({ contract: imageContract, binding: imageBinding, expectedProviderRequestHash: imagePrepared.providerRequestHash })).resolves.toMatchObject({ providerTaskId: "image-task-1" });
    await expect(adapter.submit({ contract: videoContract, binding: videoBinding, expectedProviderRequestHash: videoPrepared.providerRequestHash })).resolves.toMatchObject({ providerTaskId: "video-task-1" });
    expect(imageSubmit).toHaveBeenCalledWith(expect.objectContaining({ endpointShape: "image" }), imageBinding.providerIdempotencyKey);
    expect(videoSubmit).toHaveBeenCalledWith(expect.objectContaining({ endpointShape: "video" }), videoBinding.providerIdempotencyKey);
  });

  it("keeps the full recovery assertion available for callers that explicitly require it", () => {
    const submit = vi.fn();
    const provider: GenerationProvider = {
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: true },
      buildRequest: (input: GenerationProviderRequestInputV1) => input,
      submit,
    };
    expect(() => assertGenerationProviderCapabilities(provider)).toThrow(GenerationProviderCapabilityError);
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits an observe-only provider without requiring native retry or cancel", async () => {
    const submit = vi.fn(async () => ({ providerTaskId: "task-apimart-1" }));
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
      buildRequest: (input) => input,
      submit,
    }] });
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "1:1" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    const prepared = adapter.prepare({ contract: imageContract, binding });
    await expect(adapter.submit({ contract: imageContract, binding, expectedProviderRequestHash: prepared.providerRequestHash }))
      .resolves.toMatchObject({ providerTaskId: "task-apimart-1" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("passes the sealed semantic input to an optional contextual submit hook", async () => {
    const contextualSubmit = vi.fn(async (_request: unknown, _idempotencyKey: string, input: { mode: string }) => ({
      providerTaskId: `context-${input.mode}`,
    }));
    const submit = vi.fn();
    // submitWithContext is an optional runtime hook the adapter probes for; it is
    // not part of the public GenerationProvider surface, so widen through it.
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
      buildRequest: (input: GenerationProviderRequestInputV1) => ({ model: input.modelId, prompt: input.prompt }),
      submit,
      submitWithContext: contextualSubmit,
    } as GenerationProvider] });
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "1:1" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    const prepared = adapter.prepare({ contract: imageContract, binding });

    await expect(adapter.submit({ contract: imageContract, binding, expectedProviderRequestHash: prepared.providerRequestHash }))
      .resolves.toMatchObject({ providerTaskId: "context-text-to-image" });
    expect(contextualSubmit).toHaveBeenCalledWith(
      { model: "model.image.v1", prompt: "a red fox" },
      binding.providerIdempotencyKey,
      expect.objectContaining({ mode: "text-to-image", modelId: "model.image.v1" }),
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits a submit-only provider without inventing recovery capabilities", async () => {
    const submit = vi.fn(async () => ({ providerTaskId: "provider-reference-1" }));
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false },
      buildRequest: (input) => input,
      submit,
    }] });
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "1:1" });
    const binding = bindingFor("provider.image", imageContract.contractHash);
    const prepared = adapter.prepare({ contract: imageContract, binding });
    await expect(adapter.submit({ contract: imageContract, binding, expectedProviderRequestHash: prepared.providerRequestHash }))
      .resolves.toMatchObject({ providerTaskId: "provider-reference-1" });
  });

  it("queries a provider task without submitting again", async () => {
    const query = vi.fn(async (providerTaskId: string) => ({ status: "processing", raw: { id: providerTaskId, status: "processing" } }));
    const submit = vi.fn(async () => ({ providerTaskId: "task-1" }));
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
      buildRequest: (input) => input,
      submit,
      query,
    }] });

    await expect(adapter.query({ providerId: "provider.image", providerTaskId: "task-1" }))
      .resolves.toMatchObject({ state: "running", providerStatus: "processing", raw: { id: "task-1" } });
    expect(query).toHaveBeenCalledWith("task-1");
    expect(submit).not.toHaveBeenCalled();
  });

  it("fails closed when a provider returns an unfamiliar task status", async () => {
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: true, reconcile: false, cancel: false },
      buildRequest: (input) => input,
      submit: vi.fn(async () => ({ providerTaskId: "task-1" })),
      query: vi.fn(async () => ({ status: "provider-did-something-new" })),
    }] });

    await expect(adapter.query({ providerId: "provider.image", providerTaskId: "task-1" }))
      .resolves.toEqual({ state: "unknown", providerStatus: "provider-did-something-new" });
  });

  it.each(["found", "not_found", "indeterminate"] as const)(
    "preserves the closed %s reconciliation disposition",
    async (disposition) => {
      const reconcile = vi.fn(async () => ({ disposition, ...(disposition === "found" ? { providerTaskId: "task-1" } : {}) }));
      const adapter = createGenerationRuntimeAdapter({ providers: [{
        providerId: "provider.image",
        capabilities: { submitIdempotency: false, query: false, reconcile: true, cancel: false },
        buildRequest: (input) => input,
        submit: vi.fn(async () => ({ providerTaskId: "task-1" })),
        reconcile,
      }] });

      await expect(adapter.reconcile({ providerId: "provider.image", idempotencyKey: "idem-1" }))
        .resolves.toMatchObject({ disposition });
    },
  );

  it("returns unsupported cancellation without calling a missing provider operation", async () => {
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.image",
      capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false },
      buildRequest: (input) => input,
      submit: vi.fn(async () => ({ providerTaskId: "task-1" })),
    }] });

    await expect(adapter.cancel({ providerId: "provider.image", providerTaskId: "task-1" }))
      .resolves.toEqual({ disposition: "unsupported" });
  });

  it.each(["requested", "confirmed", "already_terminal", "too_late"] as const)(
    "preserves the closed %s provider cancellation disposition",
    async (disposition) => {
      const cancel = vi.fn(async () => ({ disposition }));
      const adapter = createGenerationRuntimeAdapter({ providers: [{
        providerId: "provider.image",
        capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: true },
        buildRequest: (input) => input,
        submit: vi.fn(async () => ({ providerTaskId: "task-1" })),
        cancel,
      }] });

      await expect(adapter.cancel({ providerId: "provider.image", providerTaskId: "task-1" }))
        .resolves.toEqual({ disposition });
      expect(cancel).toHaveBeenCalledWith("task-1");
    },
  );

  it("delegates terminal output extraction to the provider without assuming its response shape", async () => {
    const materialize = vi.fn(async ({ providerTaskId, raw }: { providerTaskId: string; raw?: unknown }) => ({
      outputs: [{ kind: "video" as const, url: "https://cdn.example/video.mp4", providerOutputId: providerTaskId }],
      raw,
    }));
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.video",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true },
      buildRequest: (input) => input,
      submit: vi.fn(async () => ({ providerTaskId: "task-1" })),
      materialize,
    }] });

    await expect(adapter.materialize({ providerId: "provider.video", providerTaskId: "task-1", raw: { provider: "opaque" } }))
      .resolves.toMatchObject({ outputs: [{ kind: "video", url: "https://cdn.example/video.mp4" }], raw: { provider: "opaque" } });
    expect(materialize).toHaveBeenCalledWith({ providerTaskId: "task-1", raw: { provider: "opaque" } });
  });

  it("accepts model3d as a first-class provider output kind", async () => {
    const adapter = createGenerationRuntimeAdapter({ providers: [{
      providerId: "provider.video",
      capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false, materialize: true },
      buildRequest: (input) => input,
      submit: vi.fn(async () => ({ providerTaskId: "task-3d" })),
      materialize: vi.fn(async () => ({ outputs: [{ kind: "model3d" as const, url: "https://cdn.example/model.glb" }] })),
    }] });

    await expect(adapter.materialize({ providerId: "provider.video", providerTaskId: "task-3d" }))
      .resolves.toMatchObject({ outputs: [{ kind: "model3d", url: "https://cdn.example/model.glb" }] });
  });

  it("creates a provider-neutral request with the sealed contract hash and idempotency key", () => {
    const imageContract = contract("provider.image", "model.image.v1", "text-to-image", { aspectRatio: "1:1" });
    const imageBinding = bindingFor("provider.image", imageContract.contractHash);
    const result = resolveExecutionContract(imageContract, imageBinding);
    expect(result).toMatchObject({ providerId: "provider.image", modelId: "model.image.v1", idempotencyKey: imageBinding.providerIdempotencyKey, contractHash: imageBinding.contractHash });
  });
});
