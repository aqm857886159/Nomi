import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import type { CapabilityContract } from "./capabilityContract";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;
type ContractOnly<Contract extends AnyCapabilityContract> =
  Exclude<keyof Contract, keyof AnyCapabilityContract> extends never ? Contract : never;
export type ContractOnlyRegistry<Contracts extends readonly AnyCapabilityContract[]> = {
  readonly [Index in keyof Contracts]: Contracts[Index] extends AnyCapabilityContract
    ? ContractOnly<Contracts[Index]>
    : never;
};

const REGISTERED_CONTRACTS = [CANVAS_READ_CAPABILITY] as const satisfies readonly CapabilityContract<
  unknown,
  unknown
>[];

export const CAPABILITY_CONTRACTS: ContractOnlyRegistry<typeof REGISTERED_CONTRACTS> = REGISTERED_CONTRACTS;
