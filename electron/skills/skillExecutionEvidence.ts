import type { SkillManifest } from "./skillManifestSchema";
import { findSkillRecord, readSkillRecords } from "./skillStore";

type LoadedSkillEvidence = { name: string; version: string };
type SkillExecutionEvidence = LoadedSkillEvidence & { stageId: string };

/** Resolve the declared craft skills for a built-in playbook and prove that
 * each referenced skill was actually present on disk when the stage ran. */
export async function loadPlaybookStageEvidence(
  playbookName: string,
  playbookVersion: string,
  stageId: string,
): Promise<SkillExecutionEvidence[]> {
  const records = await readSkillRecords();
  const playbook = findSkillRecord(playbookName, playbookName, records);
  if (!playbook?.manifest) {
    return [{ name: playbookName, version: playbookVersion, stageId }];
  }
  const refs = skillRefsForStage(playbook.manifest, stageId);
  const loaded = refs.map((ref) => {
    const skill = findSkillRecord(ref, ref, records);
    // A desktop Agent may have loaded the craft skill outside Nomi's packaged
    // skill root. Keep the declared reference in the artifact rather than
    // pretending the production run did not use it; an explicit `declared`
    // version tells the reviewer that the runtime could not fingerprint the
    // external package, without blocking an otherwise reviewable draft.
    // `skillRefs` intentionally use stable directory handles (writer-foo),
    // while a manifest may expose a dotted display name (writer.foo). Keep
    // the declared handle as the join key and only borrow the discovered
    // package version.
    return { name: ref, version: skill?.manifest?.version ?? "declared" };
  });
  return buildSkillExecutionEvidence(playbook.manifest, stageId, loaded);
}

export function skillRefsForStage(manifest: SkillManifest, stageId: string): string[] {
  return manifest.stages?.find((stage) => stage.id === stageId)?.skillRefs ?? [];
}

/**
 * Turn the skills actually loaded for a stage into durable evidence.
 * A declared-but-not-loaded skill is an execution error rather than a fake
 * evidence record; the user must never see a methodology as used when it was
 * unavailable.
 */
export function buildSkillExecutionEvidence(
  manifest: SkillManifest,
  stageId: string,
  loaded: LoadedSkillEvidence[],
): SkillExecutionEvidence[] {
  const refs = skillRefsForStage(manifest, stageId);
  const byName = new Map(loaded.map((skill) => [skill.name, skill]));
  const missing = refs.filter((ref) => !byName.has(ref));
  if (missing.length > 0) throw new Error(`Declared stage skill not loaded: ${missing.join(", ")}`);
  return refs.map((name) => ({ ...byName.get(name)!, stageId }));
}
