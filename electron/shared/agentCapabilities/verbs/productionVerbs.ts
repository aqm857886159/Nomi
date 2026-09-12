// 生产 Run 家族的十个动词（执行那一半住 `electron/capabilityCore/productionRunTransportAdapters.ts`）。
//
// 设计正本 §5.3 已拍板：这十个在 PR B 从模型面下掉（Run 是宿主的状态机，不是用户的状态）。
// PR A 只收 owner：schema 留在 `productionRunDescriptors.ts`（对外 MCP 目录也读它），描述在这里。
import { productionRunToolDescriptors, productionRunReadToolNames, productionArtifactWriteToolNames } from "../productionRunDescriptors";
import { modelArgumentTolerance } from "../modelArgumentTolerance";
import type { VerbDeclaration, VerbDescription } from "../verbDeclaration";

const PRODUCTION_GUIDELINES = Object.freeze([
  "Use run and artifact identifiers returned by Nomi. Preserve expectedVersion and revision. Paid gates must be confirmed in Nomi.",
]);

const DESCRIBE: Readonly<Record<keyof typeof productionRunToolDescriptors, VerbDescription>> = {
  get_production_run: {
    does: "Read one production run's current status, gates, jobs, budget and artifact refs.",
    useWhen: "Use it with the runId returned when the draft was created, whenever the user asks where a production run stands.",
    notWhen: "Do not use it for a single canvas generation started with nomi_generation_plan — that is nomi_generation_status. Do not use it to wait for progress (subscribe_production_run) or to pause, resume or cancel (control_production_run).",
    params: "runId is the id returned by start_production_run. Read-only; no provider work is submitted.",
  },
  subscribe_production_run: {
    does: "Read meaningful production-run progress after a cursor, with a bounded wait for new events.",
    useWhen: "Use it to follow a running production without polling get_production_run in a loop.",
    notWhen: "Do not use it to start or resume a job (control_production_run) or to read the current snapshot without waiting (get_production_run).",
    params: "runId from start_production_run; afterCursor is the last consumed event cursor (default 0); waitMs bounds the wait. Continue with the returned nextCursor to avoid duplicate events.",
  },
  read_production_artifact: {
    does: "Read a versioned production artifact's metadata and preview ref.",
    useWhen: "Use it to learn an artifact's current version before reviewing or revising it.",
    notWhen: "Do not use it when you need the actual script or plan text (read_production_artifact_content).",
    params: "runId and artifactId come from the current run projection (get_production_run).",
  },
  read_production_artifact_content: {
    does: "Read one persisted script or storyboard's content, bounded by the domain owner.",
    useWhen: "Use it only when the actual text or plan is needed for the next decision.",
    notWhen: "Do not use it just to learn the version or preview ref (read_production_artifact).",
    params: "runId and artifactId come from the current run projection (get_production_run).",
  },
  start_production_run: {
    does: "Create a reviewable brief and playbook draft for a multi-minute piece, stopping at the first review gate.",
    useWhen: "Use it when the user asks for a whole finished piece that needs a brief, a playbook and staged review.",
    notWhen: "Do not use it for a concrete image or video request — that is nomi_generation_plan. Do not use it for a storyboard you author yourself (nomi_storyboard_write) or for an approved storyboard artifact (materialize_production_storyboard).",
    params: "goal describes what the finished piece should achieve; playbook, audience, channel, tone, durationSeconds and sellingPoints are optional and never forced into a schema.",
  },
  control_production_run: {
    does: "Pause, resume, cancel, or change the trust level of one production run.",
    useWhen: "Use it when the user asks to stop, continue or cancel a production run.",
    notWhen: "Do not use it to cancel one canvas generation operation — that is nomi_generation_status with operation cancel, and not to read where the run stands (get_production_run). Paid gates and unknown provider receipts remain protected.",
    params: "runId from start_production_run; action is pause, resume, cancel or set_trust (set_trust needs trustLevel). Transitions are validated by the production owner.",
  },
  decide_production_gate: {
    does: "Record the user's decision for a creative or anchor checkpoint gate of a production run.",
    useWhen: "Use it only after the user has told you their decision for the gate shown in the current production task.",
    notWhen: "Do not decide budget or paid gates — those stay in Nomi. Do not use it to approve an artifact version (review_production_artifact).",
    params: "runId, gateId and the allowed decision come from the current production task; choiceKey selects among offered choices.",
  },
  revise_production_artifact: {
    does: "Request a new script or storyboard version from an artifact without overwriting the source version.",
    useWhen: "Use it when the user asks for changes to a production script or storyboard.",
    notWhen: "Do not use it to approve or reject a version (review_production_artifact) or to edit the creation document directly (append_to_end).",
    params: "runId, artifactId and the exact expectedVersion from read_production_artifact; kind is script or storyboard; instruction is what to change.",
  },
  review_production_artifact: {
    does: "Approve, request changes to, or reject one exact production artifact version.",
    useWhen: "Use it only after the user has reviewed the version and told you their verdict.",
    notWhen: "Do not use it to ask for a new version with concrete changes (revise_production_artifact) or to decide a checkpoint gate (decide_production_gate).",
    params: "runId, artifactId and expectedVersion from read_production_artifact; decision is approved, changes_requested or rejected. Stale review targets are rejected.",
  },
  materialize_production_storyboard: {
    does: "Attach an approved production storyboard artifact onto the canvas with its run provenance.",
    useWhen: "Use it only for a storyboard that already exists as an approved artifact of a production run.",
    notWhen: "Do not use it to author a storyboard yourself (nomi_storyboard_write), to generate or draw something (nomi_generation_plan), to wire nodes (nomi_canvas_write), or to begin a new piece (start_production_run). It cannot invent a storyboard or add shots that are not in the approved artifact.",
    params: "runId, artifactId and that artifact's exact expectedVersion from read_production_artifact; a stale version is rejected rather than silently applied.",
  },
};

export function productionVerbs(): VerbDeclaration[] {
  return Object.values(productionRunToolDescriptors).map((descriptor): VerbDeclaration => {
    const read = productionRunReadToolNames.has(descriptor.name);
    const contractId = read ? "production.run.read" : productionArtifactWriteToolNames.has(descriptor.name)
      ? "production.artifact.write" : "production.run.write";
    const effectGroups = descriptor.name === "get_production_run" || descriptor.name === "control_production_run"
      ? (["job-status-cancel"] as const)
      : descriptor.name === "start_production_run" || descriptor.name === "materialize_production_storyboard"
        ? (["finished-piece", ...(descriptor.name === "materialize_production_storyboard" ? ["canvas-node-creation" as const] : [])] as const)
        : undefined;
    return {
      name: descriptor.name,
      contractId,
      effect: read ? "read" : "reversible_local",
      nextAction: "none",
      internalGroup: "production",
      profiles: ["internal"],
      profileReason: "mcpHandwrittenTransport",
      ...(effectGroups ? { effectGroups: [...effectGroups] } : {}),
      describe: DESCRIBE[descriptor.name],
      promptGuidelines: PRODUCTION_GUIDELINES,
      schema: descriptor.parameters,
      examples: descriptor.name === "start_production_run"
        ? [{ when: "Create a reviewable brief draft:", arguments: { goal: "A short product introduction", durationSeconds: 30 } }]
        : [],
      prepareArguments: descriptor.name === "start_production_run"
        ? modelArgumentTolerance({ arrayFields: ["sellingPoints"] }) : modelArgumentTolerance({}),
    };
  });
}
