import { describe, expect, expectTypeOf, it } from "vitest";
import type { CapabilityContract } from "./capabilityContract";
import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import { CAPABILITY_CONTRACTS } from "./registry";
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
  it("registers the canvas.read contract exactly once with globally unique aliases", () => {
    expect(CAPABILITY_CONTRACTS).toEqual([CANVAS_READ_CAPABILITY]);

    const ids = CAPABILITY_CONTRACTS.map((contract) => contract.id);
    const aliases = CAPABILITY_CONTRACTS.flatMap((contract) => Object.values(contract.aliases));

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(ids).toEqual(["canvas.read"]);
    expect(aliases).toEqual(["read_canvas_state", "nomi_read_canvas"]);
    expect(CAPABILITY_CONTRACTS[0]?.exposure).toBe("mcp_safe");
  });

  it("rejects adapter, port, and executor objects at compile time", () => {
    expectTypeOf<RejectedRuntimeObjects>().toEqualTypeOf<never>();
  });
});
