import type { AssetSourceEvidence } from "../../connectors/connectorDefinition";

export const PROVENANCE_SOURCES = [
  "user_input",
  "project_asset",
  "web_fetched",
  "mcp_external",
  "skill_content",
  "host_derived",
] as const;

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];
export type ProvenanceTrust = "trusted" | "user" | "untrusted";

/** A reference into the source-of-truth record; asset evidence is never copied into a second snapshot. */
export type ProvenanceMark = Readonly<{
  source: ProvenanceSource;
  sourceRef: string;
  trust: ProvenanceTrust;
  tainted: boolean;
  assetSourceEvidence?: AssetSourceEvidence;
}>;

export type ProvenanceInput = Readonly<{
  source: ProvenanceSource;
  sourceRef: string;
  assetSourceEvidence?: AssetSourceEvidence;
  trust?: ProvenanceTrust;
  tainted?: boolean;
}>;

export type PromptSourcePart = Readonly<{
  content: string;
  provenance: ProvenanceInput | readonly ProvenanceInput[];
}>;

export type ProvenanceProjection = Readonly<Omit<ProvenanceMark, "assetSourceEvidence"> & {
  assetEvidenceRef?: string;
}>;

function assetTrust(evidence: AssetSourceEvidence | undefined): ProvenanceTrust {
  return evidence?.usageStatus === "cleared" ? "trusted" : "untrusted";
}

export function createProvenanceMark(
  source: ProvenanceSource,
  sourceRef: string,
  assetSourceEvidence?: AssetSourceEvidence,
): ProvenanceMark {
  const trust: ProvenanceTrust = source === "project_asset"
    ? assetTrust(assetSourceEvidence)
    : source === "user_input"
      ? "user"
      : source === "host_derived"
        ? "trusted"
        : "untrusted";
  return Object.freeze({
    source,
    sourceRef,
    trust,
    tainted: trust === "untrusted",
    ...(assetSourceEvidence ? { assetSourceEvidence } : {}),
  });
}

export function normalizeProvenanceMark(input: ProvenanceInput): ProvenanceMark {
  return createProvenanceMark(input.source, input.sourceRef, input.assetSourceEvidence);
}

export function uniqueProvenance(marks: readonly ProvenanceMark[]): readonly ProvenanceMark[] {
  const seen = new Set<string>();
  return Object.freeze(marks.filter((mark) => {
    const key = `${mark.source}:${mark.sourceRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

export function sectionTrust(marks: readonly ProvenanceMark[]): "trusted" | "user" | "external" {
  if (marks.some((mark) => mark.trust === "untrusted")) return "external";
  if (marks.some((mark) => mark.trust === "user")) return "user";
  return "trusted";
}

export function taintedSourceRefs(marks: readonly ProvenanceMark[]): readonly string[] {
  return Object.freeze([...new Set(marks.filter((mark) => mark.tainted).map((mark) => mark.sourceRef))]);
}

export function projectProvenance(marks: readonly ProvenanceMark[]): readonly ProvenanceProjection[] {
  return Object.freeze(uniqueProvenance(marks).map((mark) => ({
    source: mark.source,
    sourceRef: mark.sourceRef,
    trust: mark.trust,
    tainted: mark.tainted,
    ...(mark.assetSourceEvidence ? { assetEvidenceRef: mark.sourceRef } : {}),
  })));
}
