import {
  analyzeComfyWorkflowTextSmart,
  importComfyWorkflowToCatalog,
  updateComfyWorkflowInCatalog,
  reconcileComfyWorkflowText,
  type AnalyzeWorkflowResult,
  type ImportWorkflowResult,
} from "../catalog/comfyuiWorkflowImportStore";
import {
  buildComfyImportModelMapping,
  buildImportedWorkflow,
  normalizeWorkflowBinding,
  parseComfyApiWorkflow,
  type ComfyWorkflowImportDraft,
  type ImportedWorkflow,
  type WorkflowBinding,
  type WorkflowImageBinding,
  type WorkflowEnumOption,
} from "../catalog/comfyuiWorkflowImport";
import { resolveComfyWorkflowOutput } from "../catalog/comfyuiWorkflowOutput";
import { certifyMediaArtifact, type CertificationMediaDependencies, type CertificationMediaEvidence, type CertificationMediaInput, type CertificationMediaKind } from "../providerAdapter/certificationMedia";
import type { TaskStatus } from "../tasks/responseParsing";

/**
 * The ComfyUI certification adapter deliberately contains no second parser or
 * Catalog writer. It prepares the same API workflow/mapping used by the
 * existing runtime, stages through `importComfyWorkflowToCatalog`, and leaves
 * production execution to the caller's canonical certification run.
 */
export type ComfyWorkflowPreparation = {
  graph: ReturnType<typeof parseComfyApiWorkflow>;
  imported: ImportedWorkflow;
  binding: WorkflowBinding;
  mapping: ReturnType<typeof buildComfyImportModelMapping>["mapping"];
  model: ReturnType<typeof buildComfyImportModelMapping>["model"];
  parameters: ImportedWorkflow["parameters"];
};

export type ComfyUiConnectorDependencies = {
  analyzeSmart?: typeof analyzeComfyWorkflowTextSmart;
  reconcile?: typeof reconcileComfyWorkflowText;
  importWorkflow?: typeof importComfyWorkflowToCatalog;
  updateWorkflow?: typeof updateComfyWorkflowInCatalog;
  /** Injected by the canonical run owner; absent in pure parse/stage usage. */
  runCandidate?: (input: {
    vendor: string;
    candidate: { revisionId: string; modelKey: string; taskKind: string };
    request: { kind: string; prompt: string; extras?: Record<string, unknown> };
  }) => Promise<unknown>;
};

export type ComfyProductionRequest = {
  prompt: Record<string, unknown>;
  client_id: string;
  prompt_id?: string;
  partial_execution_targets?: string[];
  extra_data?: { extra_pnginfo?: { workflow?: unknown } };
};

export type ComfyProductionRunnerDependencies = {
  media: Record<string, CertificationMediaInput["source"]>;
  params?: Record<string, unknown>;
  uploadMedia?: (slot: WorkflowImageBinding, source: CertificationMediaInput["source"]) => Promise<string>;
  submitPrompt: (request: ComfyProductionRequest) => Promise<{ promptId: string }>;
  readHistory: (promptId: string) => Promise<{ status: TaskStatus; outputs?: Array<{ url: string; contentType: string }>; error?: string }>;
  readView: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  decodeImage?: CertificationMediaDependencies["decodeImage"];
  decodeMedia?: CertificationMediaDependencies["decodeMedia"];
  probeMedia?: CertificationMediaDependencies["probeMedia"];
  certificationRoot?: string;
  maxPolls?: number;
  expectedKind?: CertificationMediaKind;
  promote: (evidence: CertificationMediaEvidence[], context: { promptId: string; prepared: ComfyWorkflowPreparation }) => Promise<void> | void;
};

function asApiText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 20_000_000) {
    throw new Error("ComfyUI workflow text is missing or too large");
  }
  return value;
}

export class ComfyUiConnector {
  private readonly analyzeSmart: typeof analyzeComfyWorkflowTextSmart;
  private readonly importWorkflow: typeof importComfyWorkflowToCatalog;
  private readonly reconcileWorkflow: typeof reconcileComfyWorkflowText;
  private readonly updateWorkflow: typeof updateComfyWorkflowInCatalog;
  private readonly runCandidate?: ComfyUiConnectorDependencies["runCandidate"];

  constructor(dependencies: ComfyUiConnectorDependencies = {}) {
    this.analyzeSmart = dependencies.analyzeSmart || analyzeComfyWorkflowTextSmart;
    this.reconcileWorkflow = dependencies.reconcile || reconcileComfyWorkflowText;
    this.importWorkflow = dependencies.importWorkflow || importComfyWorkflowToCatalog;
    this.updateWorkflow = dependencies.updateWorkflow || updateComfyWorkflowInCatalog;
    this.runCandidate = dependencies.runCandidate;
  }

  /** Analyze API or UI Save workflow through the existing smart conversion. */
  analyze(text: unknown, vendorKey?: unknown): Promise<AnalyzeWorkflowResult> {
    return this.analyzeSmart(text, vendorKey);
  }

  /** Reconcile node/enum requirements against the selected native server. */
  reconcile(text: unknown, vendorKey?: unknown) {
    return this.reconcileWorkflow(text, vendorKey);
  }

  /** Build the canonical API prompt and explicit binding; never reads widget positions. */
  prepareWorkflow(input: {
    workflowText: string;
    binding: WorkflowBinding;
    enumOptions?: WorkflowEnumOption[];
    uiWorkflowText?: string;
    vendorKey?: string;
    modelKey?: string;
    labelZh?: string;
  }): ComfyWorkflowPreparation {
    const text = asApiText(input.workflowText);
    const graph = parseComfyApiWorkflow(text);
    const normalized = normalizeWorkflowBinding(input.binding, graph);
    const binding = { ...normalized, ...resolveComfyWorkflowOutput(graph, normalized) };
    const imported = buildImportedWorkflow(graph, binding, input.enumOptions);
    const built = buildComfyImportModelMapping(imported, {
      modelKey: input.modelKey || "comfy-workflow-preview",
      labelZh: input.labelZh || "ComfyUI workflow",
      vendorKey: input.vendorKey,
      draft: {
        text,
        binding,
        ...(input.uiWorkflowText ? { uiWorkflowText: input.uiWorkflowText } : {}),
      } satisfies ComfyWorkflowImportDraft,
    });
    return { graph, imported, binding, mapping: built.mapping, model: built.model, parameters: imported.parameters };
  }

  /**
   * Materialize a prepared API workflow for the real `/prompt` route. Values
   * are applied only to the explicit `{nodeId,inputKey,paramKey}` bindings;
   * links and unrelated widgets remain untouched. This is intentionally
   * recursive over the API graph and never consumes UI `widgets_values`.
   */
  buildProductionRequest(prepared: ComfyWorkflowPreparation, values: Record<string, unknown>, options: {
    clientId?: string;
    promptId?: string;
    uiWorkflowText?: string;
  } = {}): ComfyProductionRequest {
    const prompt = structuredClone(prepared.imported.templatedGraph) as Record<string, unknown>;
    const assignments = [
      ...(prepared.binding.images || []).map((item) => ({ nodeId: item.nodeId, inputKey: item.inputKey, paramKey: item.paramKey })),
      ...(prepared.binding.params || []).map((item) => ({ nodeId: item.nodeId, inputKey: item.inputKey, paramKey: item.paramKey })),
    ];
    for (const assignment of assignments) {
      const node = prompt[assignment.nodeId];
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const inputs = (node as { inputs?: unknown }).inputs;
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
      if (!Object.prototype.hasOwnProperty.call(values, assignment.paramKey)) continue;
      (inputs as Record<string, unknown>)[assignment.inputKey] = values[assignment.paramKey];
    }
    const request: ComfyProductionRequest = {
      prompt,
      client_id: options.clientId || "nomi",
      ...(options.promptId ? { prompt_id: options.promptId } : {}),
      ...(prepared.binding.outputNodeId ? { partial_execution_targets: [prepared.binding.outputNodeId] } : {}),
    };
    if (options.uiWorkflowText) {
      try {
        const workflow = JSON.parse(options.uiWorkflowText);
        request.extra_data = { extra_pnginfo: { workflow } };
      } catch {
        // The API graph remains authoritative if optional UI metadata is stale.
      }
    }
    return request;
  }

  /**
   * Execute one native ComfyUI certification transaction. Network and storage
   * concerns are explicit dependencies so the canonical run owner can bind
   * origin/lease policy; this method enforces the route order and promotion
   * gate for every caller.
   */
  async runProduction(prepared: ComfyWorkflowPreparation, deps: ComfyProductionRunnerDependencies): Promise<{
    promptId: string;
    evidence: CertificationMediaEvidence[];
  }> {
    const values: Record<string, unknown> = { ...(deps.params || {}) };
    for (const slot of prepared.binding.images || []) {
      const source = deps.media[slot.paramKey];
      if (!source) throw new Error(`missing_media:${slot.paramKey}`);
      if (!deps.uploadMedia) throw new Error("upload_unavailable");
      values[slot.paramKey] = await deps.uploadMedia(slot, source);
    }
    const request = this.buildProductionRequest(prepared, values);
    const submitted = await deps.submitPrompt(request);
    const promptId = String(submitted.promptId || "").trim();
    if (!promptId) throw new Error("prompt_missing_id");
    let history: Awaited<ReturnType<ComfyProductionRunnerDependencies["readHistory"]>> | undefined;
    for (let attempt = 0; attempt < Math.max(1, deps.maxPolls ?? 30); attempt += 1) {
      history = await deps.readHistory(promptId);
      if (history.status === "succeeded" || history.status === "failed") break;
    }
    if (!history || history.status !== "succeeded") {
      throw new Error(history?.error || "comfy_history_incomplete");
    }
    const outputs = history.outputs || [];
    if (outputs.length === 0) throw new Error("comfy_output_missing");
    const evidence: CertificationMediaEvidence[] = [];
    const expectedKind = deps.expectedKind || prepared.imported.kind;
    for (const output of outputs) {
      const viewed = await deps.readView(output.url);
      evidence.push(await certifyMediaArtifact({
        source: { bytes: viewed.bytes, contentType: viewed.contentType },
        expectedKind,
      }, {
        certificationRoot: deps.certificationRoot,
        ...(deps.decodeImage ? { decodeImage: deps.decodeImage } : {}),
        ...(deps.decodeMedia ? { decodeMedia: deps.decodeMedia } : {}),
        ...(deps.probeMedia ? { probeMedia: deps.probeMedia } : {}),
      }));
    }
    await deps.promote(evidence, { promptId, prepared });
    return { promptId, evidence };
  }

  /** Recover a submitted/unknown operation using only its opaque remote id.
   * This path intentionally has no submitPrompt or uploadMedia call, so a
   * process restart can never duplicate the remote ComfyUI job. */
  async reconcileProduction(prepared: ComfyWorkflowPreparation, remoteTaskId: string, deps: Omit<ComfyProductionRunnerDependencies, "submitPrompt" | "uploadMedia"> & {
    submitPrompt?: never;
    uploadMedia?: never;
  }): Promise<{ promptId: string; evidence: CertificationMediaEvidence[] }> {
    const promptId = String(remoteTaskId || "").trim();
    if (!promptId) throw new Error("comfy_remote_task_id_missing");
    let history: Awaited<ReturnType<ComfyProductionRunnerDependencies["readHistory"]>> | undefined;
    for (let attempt = 0; attempt < Math.max(1, deps.maxPolls ?? 30); attempt += 1) {
      history = await deps.readHistory(promptId);
      if (history.status === "succeeded" || history.status === "failed") break;
    }
    if (!history || history.status !== "succeeded") throw new Error(history?.error || "comfy_history_incomplete");
    const outputs = history.outputs || [];
    if (outputs.length === 0) throw new Error("comfy_output_missing");
    const expectedKind = deps.expectedKind || prepared.imported.kind;
    const evidence: CertificationMediaEvidence[] = [];
    for (const output of outputs) {
      const viewed = await deps.readView(output.url);
      evidence.push(await certifyMediaArtifact({ source: { bytes: viewed.bytes, contentType: viewed.contentType }, expectedKind }, {
        certificationRoot: deps.certificationRoot,
        ...(deps.decodeImage ? { decodeImage: deps.decodeImage } : {}),
        ...(deps.decodeMedia ? { decodeMedia: deps.decodeMedia } : {}),
        ...(deps.probeMedia ? { probeMedia: deps.probeMedia } : {}),
      }));
    }
    await deps.promote(evidence, { promptId, prepared });
    return { promptId, evidence };
  }

  /** Stage a disabled candidate through the existing import store. */
  stage(input: {
    workflowText: string;
    binding: WorkflowBinding;
    labelZh: string;
    uniq?: string;
    enumOptions?: WorkflowEnumOption[];
    vendorKey?: string;
    uiWorkflowText?: string;
  }): Extract<ImportWorkflowResult, { ok: true }> {
    const text = asApiText(input.workflowText);
    // Validate and normalize before opening the Catalog transaction. The store
    // performs the authoritative write and always stages enabled:false.
    const prepared = this.prepareWorkflow({ ...input, modelKey: "comfy-workflow-stage", labelZh: input.labelZh });
    const result = this.importWorkflow({
      text,
      binding: prepared.binding,
      labelZh: input.labelZh,
      ...(input.enumOptions ? { enumOptions: input.enumOptions } : {}),
      ...(input.vendorKey ? { vendorKey: input.vendorKey } : {}),
      ...(input.uiWorkflowText ? { uiWorkflowText: input.uiWorkflowText } : {}),
    }, input.uniq);
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  update(input: {
    modelKey: string;
    workflowText: string;
    binding: WorkflowBinding;
    labelZh: string;
    enumOptions?: WorkflowEnumOption[];
    vendorKey?: string;
    uiWorkflowText?: string;
  }): Extract<ImportWorkflowResult, { ok: true }> {
    const text = asApiText(input.workflowText);
    const prepared = this.prepareWorkflow({ ...input, modelKey: input.modelKey, labelZh: input.labelZh });
    const result = this.updateWorkflow({
      modelKey: input.modelKey,
      text,
      binding: prepared.binding,
      labelZh: input.labelZh,
      ...(input.enumOptions ? { enumOptions: input.enumOptions } : {}),
      ...(input.vendorKey ? { vendorKey: input.vendorKey } : {}),
      ...(input.uiWorkflowText ? { uiWorkflowText: input.uiWorkflowText } : {}),
    });
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  /** Delegate the real production test to the canonical Comfy candidate runner. */
  certify(input: {
    vendor: string;
    candidate: { revisionId: string; modelKey: string; taskKind: string };
    request: { kind: string; prompt: string; extras?: Record<string, unknown> };
  }): Promise<unknown> {
    if (!this.runCandidate) throw new Error("ComfyUI certification runner is unavailable");
    return this.runCandidate(input);
  }
}
