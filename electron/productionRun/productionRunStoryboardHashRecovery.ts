import crypto from 'node:crypto'
import fs from 'node:fs'

import { resolveOwnedArtifactFile, safeProjectRelativePath } from './artifactProjection'
import type { ProductionRun } from './productionRunTypes'

/** Restore the exact storyboard join key for pre-contentHash run artifacts. */
export function recoverStoryboardContentHashes(run: ProductionRun, projectRoot: string | null): ProductionRun {
  if (!projectRoot) return run
  let recovered = false
  const artifacts = run.artifacts.map((artifact) => {
    if (artifact.kind !== 'storyboard' || artifact.contentHash || !artifact.projectRelativePath) return artifact
    const relativePath = safeProjectRelativePath(artifact.projectRelativePath)
    if (!relativePath) return artifact
    try {
      const filePath = resolveOwnedArtifactFile(projectRoot, relativePath)
      const record = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { planHash?: unknown; plan?: unknown }
      const storedHash = typeof record.planHash === 'string' ? record.planHash.trim().toLowerCase() : ''
      if (!/^[a-f0-9]{64}$/.test(storedHash) || !record.plan || typeof record.plan !== 'object' || Array.isArray(record.plan)) return artifact
      const calculatedHash = crypto.createHash('sha256').update(JSON.stringify(record.plan)).digest('hex')
      if (storedHash !== calculatedHash) return artifact
      recovered = true
      return { ...artifact, contentHash: calculatedHash }
    } catch {
      // Legacy recovery is read-only and fail-closed. Invalid, missing, or
      // out-of-project files never become reviewable storyboard candidates.
      return artifact
    }
  })
  return recovered ? { ...run, artifacts } : run
}
