import type { ArchetypeMode, ArchetypeTransportTaskKind, ModelArchetype } from "./types";

/**
 * **The one place a mode's transport bucket is decided.**
 *
 * Three declaration layers, most specific wins:
 *   1. `mode.vendorTransportTaskKind[vendorKey]` — vendor specialization (2026-09-02).
 *      One model identity, two vendors, different routing: kie funnels every minimax-h3 /
 *      happyhorse scenario through a single createTask endpoint (so those archetypes declare
 *      `text_to_video` throughout), while Runway posts the same models' image modes to
 *      `/v1/image_to_video`.
 *   2. `mode.transportTaskKind` — per-mode override (image archetypes: t2i vs image_edit).
 *   3. `archetype.transportTaskKind` — archetype default.
 *
 * Callers **must** route through this helper rather than hand-writing
 * `mode.transportTaskKind ?? archetype.transportTaskKind`. That expression was previously
 * duplicated across ~15 call sites; every copy is a place the vendor axis silently does not
 * apply, i.e. a second source of truth for exactly the fact this module owns.
 *
 * `vendorKey` is intentionally required (`string | null | undefined` accepted, but must be
 * passed): a forgotten argument is how the pre-2026-09 `vendorParams` axis grew five call
 * sites that resolved an unspecialized archetype. Pass `null` when the vendor is genuinely
 * unknown — that reads as "no vendor specialization", which is the correct fallback.
 */
export function modeTransportFor(
  mode: Pick<ArchetypeMode, "transportTaskKind" | "vendorTransportTaskKind"> | null | undefined,
  archetype: Pick<ModelArchetype, "transportTaskKind">,
  vendorKey: string | null | undefined,
): ArchetypeTransportTaskKind;
export function modeTransportFor(
  mode: Pick<ArchetypeMode, "transportTaskKind" | "vendorTransportTaskKind"> | null | undefined,
  archetype: Pick<ModelArchetype, "transportTaskKind"> | null | undefined,
  vendorKey: string | null | undefined,
): ArchetypeTransportTaskKind | undefined;
export function modeTransportFor(
  mode: Pick<ArchetypeMode, "transportTaskKind" | "vendorTransportTaskKind"> | null | undefined,
  archetype: Pick<ModelArchetype, "transportTaskKind"> | null | undefined,
  vendorKey: string | null | undefined,
): ArchetypeTransportTaskKind | undefined {
  const vendor = typeof vendorKey === "string" ? vendorKey.trim() : "";
  const vendorOverride = vendor ? mode?.vendorTransportTaskKind?.[vendor] : undefined;
  return vendorOverride ?? mode?.transportTaskKind ?? archetype?.transportTaskKind;
}
