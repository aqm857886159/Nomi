import { describe, expect, it } from "vitest";

import {
  documentReadResultSchema,
  documentReadScopeForAlias,
  documentReadSemanticInputSchema,
  projectDocumentRead,
} from "./documentRead";

describe("document.read canonical contract", () => {
  it("accepts only the two semantic scopes and rejects authority fields", () => {
    expect(documentReadSemanticInputSchema.parse({ scope: "full" })).toEqual({ scope: "full" });
    expect(documentReadSemanticInputSchema.parse({ scope: "selection" })).toEqual({ scope: "selection" });
    expect(documentReadSemanticInputSchema.safeParse({ scope: "full", projectId: "renderer-picked" }).success).toBe(false);
    expect(documentReadSemanticInputSchema.safeParse({}).success).toBe(false);
  });

  it("projects plain text or a strict text envelope and drops private fields", () => {
    expect(projectDocumentRead("draft")).toEqual({ text: "draft" });
    expect(projectDocumentRead({ text: "draft", documentId: "private", path: "/secret" })).toEqual({ text: "draft" });
    expect(documentReadResultSchema.safeParse({ text: "draft", path: "/secret" }).success).toBe(false);
  });

  it("derives the full and selection aliases without creating another capability", () => {
    expect(documentReadScopeForAlias("read_full_text")).toBe("full");
    expect(documentReadScopeForAlias("read_selection")).toBe("selection");
    expect(documentReadScopeForAlias("read_document")).toBeUndefined();
  });
});
