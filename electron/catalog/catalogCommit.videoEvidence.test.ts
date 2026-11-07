import { describe, expect, it } from "vitest";
import { draftShapeForKind } from "./catalogCommit";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";

describe("legacy video draft requires an explicit declaration", () => {
  it.each(["opaque-model", "doubao-seedance-2-0-fast-260128"])("%s retains identity without manufacturing a default video route", (modelKey) => {
    expect(draftShapeForKind("video", modelKey)).toEqual({ targetKind: "video", modelFields: [] });
  });
  it("a guessed native profile or endpoint probe is not a documentation-backed model declaration", () => {
    expect(draftShapeForKind("video", "opaque-model", null, nativeWireProfileForArchetype("volcengine-seedance-2"))).toEqual({ targetKind: "video", modelFields: [] });
  });
});
