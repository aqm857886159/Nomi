import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VERB_DECLARATIONS } from "../verbDeclarations";
import { assertVerbFieldProvenance } from "./verbFieldProvenance";

describe("verb output provenance", () => {
  it("checks the verb output even when its capability output is unknown", () => {
    const declarations = VERB_DECLARATIONS.map((verb) => verb.name === "list_models"
      ? { ...verb, outputSchema: z.object({ models: z.array(z.object({ unrelated: z.string() })) }) }
      : verb);
    expect(() => assertVerbFieldProvenance(declarations)).toThrow(/list_models.*不返回/);
  });

  it("does not borrow a sibling capability branch when the verb declares its own output", () => {
    const declarations = VERB_DECLARATIONS.map((verb) => verb.name === "edit_timeline"
      ? { ...verb, outputSchema: z.object({ revision: z.string() }) }
      : verb);
    // Signed model face: undo routes by changeId; the old undoToken wording is retired.
    expect(() => assertVerbFieldProvenance(declarations)).toThrow(/changeId/);
  });

  it("falls back to the capability only when the verb has no output declaration", () => {
    expect(() => assertVerbFieldProvenance(VERB_DECLARATIONS.map((verb) => verb.name === "edit_timeline"
      ? { ...verb, outputSchema: undefined } : verb))).not.toThrow();
  });

  it("rejects an undeclared catalog result instead of reviving its removed exception", () => {
    const declarations = VERB_DECLARATIONS.map((verb) => verb.name === "list_models"
      ? { ...verb, outputSchema: z.unknown() } : verb);
    expect(() => assertVerbFieldProvenance(declarations)).toThrow(/list_models.*返回形状没有声明/);
  });
});
