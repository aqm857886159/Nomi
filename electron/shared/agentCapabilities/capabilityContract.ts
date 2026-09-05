import type { ZodType } from "zod";

export type CapabilityEffect = "read" | "reversible_write" | "destructive" | "paid";
/**
 * The Host approval boundary only needs the side-effect class.  Tool names and
 * operation strings are projections; this closed vocabulary is the authority
 * used to decide whether a user decision may be reused.
 */
export const CAPABILITY_EFFECT_CLASSES = ["reversible_local", "spend", "irreversible"] as const;
export type CapabilityEffectClass = (typeof CAPABILITY_EFFECT_CLASSES)[number];
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
  readonly effectClass: CapabilityEffectClass;
  readonly operationEffectClasses?: Readonly<Record<string, CapabilityEffectClass>>;
  readonly execution: {
    readonly port: CapabilityPortKind;
    readonly availability: CapabilityAvailability;
  };
  readonly exposure: CapabilityExposure;
  readonly requiredScope: string;
  readonly targetKind: string;
  readonly projections: Readonly<Partial<Record<CapabilityProjectionSurface, CapabilityProjectionMetadata>>>;
};
