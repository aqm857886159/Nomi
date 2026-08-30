import { describe, expect, it } from "vitest";
import { parseCustomCapabilityContract } from "../shared/customCapabilityContract";
import { resolveCustomCallExecution } from "./customCallMode";
import type { Mapping, Model } from "./types";
import type { TaskRequest } from "../runtime";

function model(vendorKey = "relay-a"): Model {
  return {
    vendorKey,
    modelKey: "bytedance/seedance-2",
    labelZh: "Seedance 2",
    kind: "video",
    enabled: true,
    customCall: {
      script: "return 'fallback'",
      modes: {
        first: { script: "return 'first'", updatedAt: "2026-08-15T00:00:00.000Z" },
        firstlast: { script: "return 'firstlast'", updatedAt: "2026-08-15T00:00:00.000Z" },
      },
      updatedAt: "2026-08-15T00:00:00.000Z",
    },
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };
}

function request(modeId?: string, kind: TaskRequest["kind"] = "image_to_video"): TaskRequest {
  return {
    kind,
    prompt: "move",
    extras: {
      modelKey: "bytedance/seedance-2",
      ...(modeId ? { archetype: { id: "seedance-2", modeId } } : {}),
    },
  };
}

function mapping(taskKind: Mapping["taskKind"] = "image_to_video"): Mapping {
  return {
    id: "mapping-1",
    vendorKey: "relay-a",
    modelKey: "bytedance/seedance-2",
    taskKind,
    name: "wire",
    enabled: true,
    create: { method: "POST", path: "/generate" },
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };
}

describe("resolveCustomCallExecution", () => {
  it("selects the exact mode script and returns archetype-validated context", () => {
    expect(resolveCustomCallExecution(model(), request("first"), mapping())).toEqual({
      script: "return 'first'",
      source: "mode",
      taskKind: "image_to_video",
      modeId: "first",
    });
    expect(resolveCustomCallExecution(model(), request("firstlast"), mapping())?.script).toContain("firstlast");
  });

  it("allows the legacy model script only for the kind minimum default task", () => {
    expect(resolveCustomCallExecution(model(), request("t2v", "text_to_video"), mapping("text_to_video"))).toEqual({
      script: "return 'fallback'",
      source: "model",
      taskKind: "text_to_video",
      modeId: "t2v",
    });
    expect(resolveCustomCallExecution(model(), request("omni"), mapping())).toBeNull();
  });

  it("does not trust an unknown or task-kind-incompatible mode id", () => {
    expect(resolveCustomCallExecution(model(), request("made-up"), mapping())).toBeNull();
    expect(resolveCustomCallExecution(model(), request("first", "text_to_video"), mapping("text_to_video"))).toBeNull();
  });

  it("derives mode identity from the model archetype, independent of provider names", () => {
    const a = resolveCustomCallExecution(model("relay-a"), request("first"), mapping());
    const b = resolveCustomCallExecution(model("a-brand-new-platform"), request("first"), {
      ...mapping(),
      vendorKey: "a-brand-new-platform",
    });
    expect(a).toEqual(b);
  });

  it("selects a mode declared by a newly added custom capability contract", () => {
    const custom = model("future-relay");
    custom.modelKey = "future/video-v1";
    custom.meta = {
      customCapabilityContract: {
        version: 1,
        kind: "video",
        defaultModeId: "references",
        transportTaskKind: "image_to_video",
        modes: [
          {
            id: "references",
            intent: "character",
            vendorTerm: "References",
            hint: "Animate reference images",
            promptRequired: true,
            transportTaskKind: "image_to_video",
            slots: [],
            params: [],
          },
          {
            id: "firstlast",
            intent: "firstlast",
            vendorTerm: "First and last frame",
            hint: "Animate between two frames",
            promptRequired: true,
            transportTaskKind: "image_to_video",
            slots: [],
            params: [],
          },
        ],
      },
    };
    custom.customCall = {
      script: "return 'fallback'",
      modes: {
        references: { script: "return 'references'", updatedAt: "2026-08-15T00:00:00.000Z" },
      },
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const customRequest: TaskRequest = {
      kind: "image_to_video",
      prompt: "move",
      extras: {
        modelKey: custom.modelKey,
        archetype: {
          id: `custom-capability:${encodeURIComponent(custom.modelKey)}`,
          modeId: "references",
        },
      },
    };

    expect(resolveCustomCallExecution(custom, customRequest, { ...mapping(), vendorKey: custom.vendorKey }))
      .toMatchObject({ source: "mode", modeId: "references", script: "return 'references'" });
  });

  it("does not dispatch a built-in seedream mode when an explicit contract is malformed", () => {
    const custom = model("future-relay");
    custom.modelKey = "seedream";
    custom.kind = "image";
    custom.meta = {
      customCapabilityContract: {
        version: 1,
        kind: "image",
        defaultModeId: "create",
        transportTaskKind: "text_to_image",
        modes: "not-an-array",
      },
    };
    custom.customCall = {
      modes: { edit: { script: "return 'edited'", updatedAt: "2026-08-15T00:00:00.000Z" } },
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const editRequest: TaskRequest = {
      kind: "image_edit",
      prompt: "edit",
      extras: { modelKey: "seedream", archetype: { id: "seedream", modeId: "edit" } },
    };

    expect(resolveCustomCallExecution(custom, editRequest, {
      ...mapping("image_edit"),
      vendorKey: custom.vendorKey,
      modelKey: custom.modelKey,
    })).toBeNull();
  });

  it("blocks an invalid explicit contract instead of falling back to the generic script", () => {
    const custom = model();
    custom.modelKey = "unknown-future-model";
    custom.meta = {
      customCapabilityContract: {
        version: 1,
        defaultModeId: "duplicate",
        transportTaskKind: "image_to_video",
        modes: [
          { id: "duplicate" },
          { id: "duplicate" },
        ],
      },
    };
    const customRequest: TaskRequest = {
      kind: "image_to_video",
      prompt: "move",
      extras: {
        modelKey: custom.modelKey,
        archetype: { id: "custom-capability:unknown-future-model", modeId: "duplicate" },
      },
    };

    expect(resolveCustomCallExecution(custom, customRequest, mapping())).toBeNull();
  });

  it("does not execute a mode accepted only by the legacy id/task validator", () => {
    const custom = model("future-relay");
    custom.modelKey = "future/video-v1";
    custom.meta = {
      customCapabilityContract: {
        version: 1,
        kind: "video",
        defaultModeId: "references",
        transportTaskKind: "image_to_video",
        modes: [
          { id: "references", transportTaskKind: "image_to_video" },
        ],
      },
    };
    custom.customCall = {
      modes: {
        references: { script: "return 'references'", updatedAt: "2026-08-15T00:00:00.000Z" },
      },
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const customRequest: TaskRequest = {
      kind: "image_to_video",
      prompt: "move",
      extras: {
        modelKey: custom.modelKey,
        archetype: {
          id: `custom-capability:${encodeURIComponent(custom.modelKey)}`,
          modeId: "references",
        },
      },
    };

    expect(parseCustomCapabilityContract(custom.meta)).toBeNull();
    expect(resolveCustomCallExecution(custom, customRequest, {
      ...mapping(),
      vendorKey: custom.vendorKey,
      modelKey: custom.modelKey,
    })).toBeNull();
  });
});
