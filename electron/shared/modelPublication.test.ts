import { describe, expect, it } from "vitest";
import { parseCustomCapabilityContract } from "./customCapabilityContract";
import { derivePublishedExecution } from "./modelPublication";

const model = (kind: string, extra: Record<string, unknown> = {}) => ({
  vendorKey: "relay",
  modelKey: `${kind}-model`,
  kind,
  enabled: true,
  ...extra,
});

const imageContract = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  kind: "image",
  defaultModeId: "create",
  transportTaskKind: "text_to_image",
  modes: [
    {
      id: "create",
      intent: "text",
      vendorTerm: "Create",
      hint: "Create an image from text",
      promptRequired: true,
      slots: [],
      params: [],
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "Edit",
      hint: "Edit an existing image",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [],
      params: [],
    },
  ],
  ...overrides,
});

describe("published execution contract", () => {
  it("keeps the adapter-less legacy fallback text-only", () => {
    expect(derivePublishedExecution(model("text"))).toEqual({ published: true, publishedModes: ["chat"] });
    for (const kind of ["image", "video", "audio", "model3d"]) {
      expect(derivePublishedExecution(model(kind))).toEqual({ published: false, publishedModes: [] });
    }
  });

  it("derives exact media modes from enabled executable mappings", () => {
    expect(derivePublishedExecution(model("image"), {
      mappings: [
        { vendorKey: "relay", modelKey: "image-model", taskKind: "text_to_image", enabled: true },
        { vendorKey: "relay", modelKey: "image-model", taskKind: "image_edit", enabled: false },
      ],
    })).toEqual({ published: true, publishedModes: ["text_to_image"] });
  });

  it("does not publish an active revision when it has no verified mode", () => {
    expect(derivePublishedExecution(model("video", {
      meta: { adapter: { state: "failed", activeRevision: "revision-good", modes: [] } },
    }))).toEqual({ published: false, publishedModes: [] });
  });

  it("treats an explicit current publication mask as authoritative over historical active-revision modes and mappings", () => {
    expect(derivePublishedExecution(model("image", {
      meta: { adapter: {
        state: "verified",
        activeRevision: "revision-old",
        publicationModes: ["image_edit"],
        modes: [
          { taskKind: "text_to_image", state: "verified" },
          { taskKind: "image_edit", state: "verified" },
        ],
      } },
    }), {
      mappings: [
        { vendorKey: "relay", modelKey: "image-model", taskKind: "text_to_image", enabled: true },
        { vendorKey: "relay", modelKey: "image-model", taskKind: "image_edit", enabled: true },
      ],
    })).toEqual({ published: true, publishedModes: ["image_edit"] });

    expect(derivePublishedExecution(model("image", {
      meta: { adapter: {
        state: "verified",
        activeRevision: "revision-old",
        publicationModes: [],
        modes: [{ taskKind: "text_to_image", state: "verified" }],
      } },
    }))).toEqual({ published: false, publishedModes: [] });
  });

  it("uses a current mask as publication evidence for restored mapping-less text execution", () => {
    expect(derivePublishedExecution(model("text", {
      meta: { adapter: { publicationModes: ["chat"] } },
    }))).toEqual({ published: true, publishedModes: ["chat"] });
  });

  it("keeps an active text revision on its direct chat path while repair modes are temporarily empty", () => {
    expect(derivePublishedExecution(model("text", {
      meta: { adapter: { state: "testing", activeRevision: "revision-good", modes: [] } },
    }))).toEqual({ published: true, publishedModes: ["chat"] });
  });

  it("publishes a legacy generic custom-call script only for the minimal default mode", () => {
    expect(derivePublishedExecution(model("image", { customCall: { script: "return 'image'" } })))
      .toEqual({ published: true, publishedModes: ["text_to_image"] });
    expect(derivePublishedExecution(model("video", { customCall: { script: "return 'video'" } })))
      .toEqual({ published: true, publishedModes: ["text_to_video"] });
  });

  it("requires taskKind or capability-contract evidence for mode-specific custom-call publication", () => {
    expect(derivePublishedExecution(model("image", {
      customCall: { modes: { mystery: { script: "return 'unknown'" } } },
    }))).toEqual({ published: false, publishedModes: [] });
    expect(derivePublishedExecution(model("image", {
      customCall: { modes: { image_edit: { script: "return 'edited'" } } },
    }))).toEqual({ published: false, publishedModes: [] });
    expect(derivePublishedExecution(model("video", {
      customCall: { modes: { create: { script: "return 'created'" }, reference: { script: "return 'reference'" } } },
      meta: { customCapabilityContract: {
        version: 1,
        kind: "video",
        defaultModeId: "create",
        transportTaskKind: "text_to_video",
        modes: [
          {
            id: "create",
            intent: "text",
            vendorTerm: "Create",
            hint: "Create a video from text",
            promptRequired: true,
            slots: [],
            params: [],
          },
          {
            id: "reference",
            intent: "single",
            vendorTerm: "Reference",
            hint: "Animate a reference image",
            promptRequired: true,
            transportTaskKind: "image_to_video",
            slots: [],
            params: [],
          },
        ],
      } },
    }))).toEqual({ published: true, publishedModes: ["text_to_video", "image_to_video"] });
  });

  it("combines the generic default with independently proven mode-specific scripts", () => {
    expect(derivePublishedExecution(model("image", {
      customCall: {
        script: "return 'created'",
        modes: { edit: { script: "return 'edited'" } },
      },
      meta: { customCapabilityContract: {
        version: 1,
        kind: "image",
        defaultModeId: "create",
        transportTaskKind: "text_to_image",
        modes: [
          {
            id: "create",
            intent: "text",
            vendorTerm: "Create",
            hint: "Create an image from text",
            promptRequired: true,
            slots: [],
            params: [],
          },
          {
            id: "edit",
            intent: "edit",
            vendorTerm: "Edit",
            hint: "Edit an existing image",
            promptRequired: true,
            transportTaskKind: "image_edit",
            slots: [],
            params: [],
          },
        ],
      } },
    }))).toEqual({ published: true, publishedModes: ["image_edit"] });
  });

  it("does not publish mode scripts from a malformed capability contract the runtime cannot execute", () => {
    expect(derivePublishedExecution(model("image", {
      customCall: { modes: { edit: { script: "return 'edited'" } } },
      meta: { customCapabilityContract: {
        version: 1,
        kind: "image",
        modes: [{ id: "edit", transportTaskKind: "image_edit" }],
      } },
    }))).toEqual({ published: false, publishedModes: [] });
  });

  it("rejects a contract that passes the legacy id/task validator but fails the formal V1 parser", () => {
    const malformedContract = {
      ...imageContract(),
      modes: [
        {
          id: "create",
          intent: "text",
          vendorTerm: "Create",
          hint: "Create an image from text",
          promptRequired: true,
          slots: [],
          params: [],
        },
        { id: "edit", transportTaskKind: "image_edit" },
      ],
    };
    const meta = { customCapabilityContract: malformedContract };

    expect(parseCustomCapabilityContract(meta)).toBeNull();
    expect(derivePublishedExecution(model("image", {
      customCall: { modes: { edit: { script: "return 'edited'" } } },
      meta,
    }))).toEqual({ published: false, publishedModes: [] });
  });

  it("publishes only the scripted taskKind proven by a built-in capability archetype", () => {
    expect(derivePublishedExecution({
      ...model("image"),
      modelKey: "seedream",
      customCall: { modes: { edit: { script: "return 'edited'" } } },
    })).toEqual({ published: true, publishedModes: ["image_edit"] });
  });

  it("rejects an explicit contract whose kind conflicts with the catalog model kind", () => {
    expect(derivePublishedExecution(model("image", {
      customCall: { modes: { edit: { script: "return 'edited'" } } },
      meta: { customCapabilityContract: imageContract({ kind: "video" }) },
    }))).toEqual({ published: false, publishedModes: [] });
  });

  it("does not fall back to seedream archetype when an explicit contract has non-array modes", () => {
    expect(derivePublishedExecution({
      ...model("image"),
      modelKey: "seedream",
      customCall: { modes: { edit: { script: "return 'edited'" } } },
      meta: { customCapabilityContract: imageContract({ modes: "not-an-array" }) },
    })).toEqual({ published: false, publishedModes: [] });
  });

  it.each([
    ["version", imageContract({ version: 2 })],
    ["missing default", imageContract({ defaultModeId: "missing" })],
    ["duplicate mode", imageContract({ modes: [{ id: "edit", transportTaskKind: "image_edit" }, { id: "edit", transportTaskKind: "image_edit" }] })],
    ["invalid mode id", imageContract({ defaultModeId: "prototype", modes: [{ id: "prototype", transportTaskKind: "image_edit" }] })],
    ["root task mismatch", imageContract({ transportTaskKind: "text_to_video" })],
    ["default task mismatch", imageContract({ modes: [{ id: "create", transportTaskKind: "image_edit" }, { id: "edit", transportTaskKind: "image_edit" }] })],
    ["mode task mismatch", imageContract({ modes: [{ id: "create" }, { id: "edit", transportTaskKind: "image_to_video" }] })],
    ["null contract", null],
  ])("treats malformed explicit %s contracts as terminal instead of using identity fallback", (_name, contract) => {
    expect(derivePublishedExecution({
      ...model("image"),
      modelKey: "seedream",
      customCall: {
        script: "return 'generic'",
        modes: { edit: { script: "return 'edited'" } },
      },
      meta: { customCapabilityContract: contract },
    })).toEqual({ published: false, publishedModes: [] });
  });

  it("does not treat a model-level generic script as legacy fallback when an explicit contract exists", () => {
    expect(derivePublishedExecution(model("image", {
      customCall: { script: "return 'generic'" },
      meta: { customCapabilityContract: imageContract() },
    }))).toEqual({ published: false, publishedModes: [] });
  });
});
