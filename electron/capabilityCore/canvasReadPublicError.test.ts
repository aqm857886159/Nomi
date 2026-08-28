import { describe, expect, it } from "vitest";

import { canvasReadRpcError } from "./canvasReadPublicError";

describe("canvas read public recovery", () => {
  it.each(["lease_expired", "lease_revoked"] as const)("%s tells the caller to open a new project session", (code) => {
    const error = Object.assign(new Error("private lease detail"), { code });

    const projected = canvasReadRpcError(error);

    expect(projected.code).toBe(code);
    expect(projected.nextAction).toBe("Choose a project and open a new project session");
    expect(projected.message).not.toContain("private lease detail");
  });
});
