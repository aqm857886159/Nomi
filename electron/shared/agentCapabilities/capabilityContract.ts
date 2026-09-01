import type { ZodType } from "zod";

export type CapabilityEffect = "read" | "reversible_write" | "destructive" | "paid";
export type CapabilityApproval = "none" | "proposal" | "human_receipt";
export type CapabilityExposure = "internal_only" | "mcp_safe" | "legacy_unverified";
export type CapabilityPortKind = "document" | "canvas" | "timeline" | "production-run" | "asset" | "export" | "skills";
export type CapabilityAvailability = "main_only" | "renderer_required" | "main_or_renderer";
export type CapabilityProjectionSurface = "pi" | "mcp" | "ui";

export type CapabilityProjectionMetadata = {
  readonly description: string;
};

export type CapabilityContract<Input, Output> = {
  readonly id: string;
  readonly version: number;
  readonly aliases: Readonly<Partial<Record<CapabilityProjectionSurface, string>>>;
  readonly additionalAliases?: Readonly<Partial<Record<CapabilityProjectionSurface, readonly string[]>>>;
  readonly inputSchema: ZodType<Input>;
  readonly outputSchema: ZodType<Output>;
  readonly effect: CapabilityEffect;
  readonly execution: {
    readonly port: CapabilityPortKind;
    readonly availability: CapabilityAvailability;
  };
  readonly exposure: CapabilityExposure;
  readonly requiredScope: string;
  readonly targetKind: string;
  readonly approval: CapabilityApproval;
  readonly projections: Readonly<Partial<Record<CapabilityProjectionSurface, CapabilityProjectionMetadata>>>;
};
