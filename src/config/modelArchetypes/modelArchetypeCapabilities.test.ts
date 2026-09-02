import { describe, expect, it } from "vitest";
import {
  SEEDANCE_2_APIMART_ARCHETYPE,
  SEEDANCE_2_5_APIMART_ARCHETYPE,
} from "../../../electron/shared/videoCapabilities";

describe("model capability facts", () => {
  it("declares Seedance expression channels without inventing a native camera control", () => {
    const mode = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((item) => item.id === "omni");
    expect(mode?.expressionChannels).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "camera_motion", via: "prompt", status: "documented" }),
      expect.objectContaining({ signal: "motion_reference", via: "reference_slot", slotKind: "video_ref", status: "documented" }),
    ]));
    expect(mode).not.toHaveProperty("cameraControl");
  });

  it("keeps Seedance 2.0 audio dependency in the mode slot declaration", () => {
    const omni = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((item) => item.id === "omni");
    expect(omni?.slots.find((slot) => slot.kind === "audio_ref")?.requiresAnyOf)
      .toEqual(["image_ref", "video_ref"]);
  });

  it("does not assume Seedance 2.5 has the Seedance 2.0 audio dependency", () => {
    const omni = SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((item) => item.id === "omni");
    expect(omni?.slots.find((slot) => slot.kind === "audio_ref")?.requiresAnyOf).toBeUndefined();
  });
});
