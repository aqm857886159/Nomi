import { describe, expect, expectTypeOf, it } from "vitest";
import type { CapabilityContract } from "./capabilityContract";
import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import { CANVAS_WRITE_CAPABILITY } from "./canvasWrite";
import { DOCUMENT_READ_CAPABILITY, DOCUMENT_READ_ALIASES } from "./documentRead";
import { DOCUMENT_WRITE_CAPABILITY, DOCUMENT_WRITE_ALIASES } from "./documentWrite";
import { CAPABILITY_CONTRACTS, resolveCapabilityAlias } from "./registry";
import type { ContractOnlyRegistry } from "./registry";

type AssertNever<Value extends never> = Value;
type RuntimeObject = {
  readonly invoke: () => void;
};
type ContractWithRuntimeObjects = CapabilityContract<unknown, unknown> & {
  readonly adapter: RuntimeObject;
  readonly port: RuntimeObject;
  readonly executor: RuntimeObject;
};
type RejectedRuntimeObjects = AssertNever<ContractOnlyRegistry<readonly [ContractWithRuntimeObjects]>[0]>;

describe("capability contract registry", () => {
  it("registers canonical contracts exactly once with globally unique aliases", () => {
    expect(CAPABILITY_CONTRACTS).toEqual([
      CANVAS_READ_CAPABILITY,
      CANVAS_WRITE_CAPABILITY,
      DOCUMENT_READ_CAPABILITY,
      DOCUMENT_WRITE_CAPABILITY,
    ]);

    const ids = CAPABILITY_CONTRACTS.map((contract) => contract.id);
    const aliases = CAPABILITY_CONTRACTS.flatMap((contract) => Object.values(contract.aliases));

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(ids).toEqual(["canvas.read", "canvas.write", "document.read", "document.write"]);
    expect(aliases).toEqual([
      "read_canvas_state",
      "nomi_read_canvas",
      "set_node_prompt",
      "read_full_text",
      "insert_at_cursor",
    ]);
    expect(CAPABILITY_CONTRACTS[0]?.exposure).toBe("mcp_safe");
    expect(resolveCapabilityAlias(CANVAS_WRITE_CAPABILITY.aliases.pi)?.contract).toBe(CANVAS_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias("nomi_set_node_prompt")).toBeUndefined();
    expect(resolveCapabilityAlias(DOCUMENT_READ_ALIASES.selection)?.contract).toBe(DOCUMENT_READ_CAPABILITY);
    expect(resolveCapabilityAlias(DOCUMENT_WRITE_ALIASES.replace)?.contract).toBe(DOCUMENT_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias(DOCUMENT_WRITE_ALIASES.append)?.contract).toBe(DOCUMENT_WRITE_CAPABILITY);
  });

  it("rejects adapter, port, and executor objects at compile time", () => {
    expectTypeOf<RejectedRuntimeObjects>().toEqualTypeOf<never>();
  });
});
