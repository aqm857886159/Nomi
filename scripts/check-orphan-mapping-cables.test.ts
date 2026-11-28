import { expect, it } from "vitest";
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins";
import type { Mapping } from "../electron/catalog/types";
import { findOrphanMappingCables } from "./check-orphan-mapping-cables";

it("checks the seeded sample-final wire against its declared transport, including misspellings and wrong buckets", () => {
  const { state } = applyBuiltinSeeds(
    { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} },
    "2026-11-26T00:00:00.000Z",
  );
  const final = state.mappings.find((row) => row.enabled && row.vendorKey === "apimart"
    && row.modelKey === "doubao-seedance-2.5-sample" && row.modeId === "sample-final");
  expect(final?.taskKind).toBe("text_to_video");
  if (!final) throw new Error("Missing sample-final mapping");

  const check = (changes: Partial<Mapping>) =>
    findOrphanMappingCables({ ...state, mappings: [{ ...final, ...changes }] });
  expect(check({})).toEqual([]);
  expect(check({ taskKind: "image_to_video" })).toMatchObject([{ kind: "bucket" }]);
  expect(check({ modeId: "sample-finall" })).toMatchObject([{ kind: "spelling" }]);
});
