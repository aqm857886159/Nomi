#!/usr/bin/env node
// Semantic vocabulary ownership gate. See CLAUDE.md R14.1.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normalizeMembers, scanRepository } from './check-vocabularies-scan.mjs'

export { scanRepository }
const MIN_REASON_LENGTH = 12
const GENERIC_AUTHORITY_REASON = /is the intentional authoritative vocabulary for this local contract/i

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return argv[index + 1]
}

function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return { debtCap: 0, registered: [], debt: [] }
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
}

function git(repoRoot, args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

function normalizedRelativePath(repoRoot, target) {
  const realRoot = fs.realpathSync(repoRoot)
  const realTarget = fs.realpathSync(target)
  const relative = path.relative(realRoot, realTarget).split(path.sep).join('/')
  return relative === '..' || relative.startsWith('../') ? null : relative
}

function resolveCommit(repoRoot, ref) {
  const result = git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])
  return result.status === 0 ? result.stdout.trim() : null
}

function readBaselineAtCommit(repoRoot, relativeBaselinePath, commit) {
  const result = git(repoRoot, ['show', `${commit}:${relativeBaselinePath}`])
  if (result.status !== 0) return null
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) }
  }
}

function referenceFromFile(referenceBaselinePath) {
  if (!fs.existsSync(referenceBaselinePath)) {
    return { error: `explicit reference baseline does not exist：${referenceBaselinePath}` }
  }
  try {
    return {
      reference: {
        baseline: JSON.parse(fs.readFileSync(referenceBaselinePath, 'utf8')),
        label: `file:${referenceBaselinePath}`,
      },
    }
  } catch (error) {
    return {
      error: `explicit reference baseline is invalid JSON：${referenceBaselinePath}（${error instanceof Error ? error.message : String(error)}）`,
    }
  }
}

export function resolveReferenceBaselines({ repoRoot, baselinePath, referenceBaselinePath, environment }) {
  const references = []
  const errors = []
  const seenCommits = new Set()

  if (referenceBaselinePath) {
    const explicit = referenceFromFile(referenceBaselinePath)
    if (explicit.error) errors.push(explicit.error)
    else references.push(explicit.reference)
  }

  const workTree = git(repoRoot, ['rev-parse', '--show-toplevel'])
  if (workTree.status !== 0) {
    return {
      errors,
      references,
      seed: errors.length === 0 && references.length === 0,
      seedReason: 'repository has no readable Git history',
    }
  }

  const gitRoot = workTree.stdout.trim()
  const relativeBaselinePath = normalizedRelativePath(gitRoot, baselinePath)
  if (!relativeBaselinePath) {
    errors.push(`baseline path is outside the Git worktree：${baselinePath}`)
    return { errors, references, seed: false }
  }

  const envRef = environment.VOCAB_BASE_REF?.trim()
  const hasExplicitCommit = Boolean(envRef && !/^0+$/.test(envRef))
  const shallow = git(gitRoot, ['rev-parse', '--is-shallow-repository'])
  if (shallow.status === 0 && shallow.stdout.trim() === 'true' && !referenceBaselinePath && !hasExplicitCommit) {
    errors.push('shallow Git history cannot prove the historical debt ratchet; provide VOCAB_BASE_REF')
  }

  const addCommit = (ref, label, { required = false } = {}) => {
    const commit = resolveCommit(gitRoot, ref)
    if (!commit) {
      if (required) errors.push(`reference commit is unavailable：${label}（${ref}）`)
      return
    }
    if (seenCommits.has(commit)) return
    seenCommits.add(commit)
    const baseline = readBaselineAtCommit(gitRoot, relativeBaselinePath, commit)
    if (baseline?.parseError) {
      errors.push(`reference baseline is invalid JSON：${label}:${relativeBaselinePath}（${baseline.parseError}）`)
      return
    }
    if (baseline) references.push({ baseline, label: `${label}:${relativeBaselinePath}`, commit })
  }

  if (hasExplicitCommit) addCommit(envRef, `VOCAB_BASE_REF=${envRef}`, { required: true })

  const status = git(gitRoot, ['status', '--porcelain', '--', relativeBaselinePath])
  if (status.status === 0 && status.stdout.trim()) addCommit('HEAD', 'HEAD')

  addCommit('HEAD^1', 'HEAD^1')
  addCommit('origin/main', 'origin/main')

  const mergeBase = git(gitRoot, ['merge-base', 'HEAD', 'origin/main'])
  if (mergeBase.status === 0 && mergeBase.stdout.trim()) {
    addCommit(mergeBase.stdout.trim(), `merge-base(${mergeBase.stdout.trim()})`)
  }

  const baselineHistory = git(gitRoot, ['log', '--format=%H', '--', relativeBaselinePath])
  const historyCommits =
    baselineHistory.status === 0 ? baselineHistory.stdout.trim().split(/\r?\n/).filter(Boolean) : []
  const onlyHistoricalBaseline =
    historyCommits.length === 1 ? readBaselineAtCommit(gitRoot, relativeBaselinePath, historyCommits[0]) : null
  const firstCommittedSnapshot = Boolean(onlyHistoricalBaseline && !onlyHistoricalBaseline.parseError)
  const firstUncommittedSnapshot = historyCommits.length === 0
  const seed = errors.length === 0 && references.length === 0 && (firstCommittedSnapshot || firstUncommittedSnapshot)

  return {
    errors,
    references,
    seed,
    seedReason: !seed ? 'no trusted historical baseline is available' : 'this is the first readable baseline snapshot',
  }
}

function writePendingEntries(baselinePath, baseline, vocabularies) {
  const next = {
    debtCap: Number(baseline.debtCap ?? 0),
    registered: [...(baseline.registered ?? [])],
    debt: [...(baseline.debt ?? [])],
  }
  if (baseline.converged !== undefined) next.converged = [...baseline.converged]
  const knownSites = new Set(baselineEntries(next).map((entry) => entry.site))
  for (const vocabulary of vocabularies) {
    if (knownSites.has(vocabulary.site)) continue
    next.debt.push({
      site: vocabulary.site,
      members: vocabulary.members,
      reason: 'TODO: explain why this owner cannot reuse an existing vocabulary, or link its convergence plan',
    })
  }
  next.registered.sort((left, right) => left.site.localeCompare(right.site))
  next.debt.sort((left, right) => left.site.localeCompare(right.site))
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

function baselineEntries(baseline) {
  return [
    ...(baseline.registered ?? []).map((entry) => ({ ...entry, bucket: 'registered' })),
    ...(baseline.debt ?? []).map((entry) => ({ ...entry, bucket: 'debt' })),
  ]
}

function validateBaseline(baseline) {
  const failures = []
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return [{ kind: 'invalid-baseline', message: 'baseline root must be an object' }]
  }
  if (!Number.isInteger(baseline.debtCap) || baseline.debtCap < 0) {
    failures.push({ kind: 'invalid-baseline', message: 'debtCap must be a non-negative integer' })
  }
  for (const bucket of ['registered', 'debt']) {
    if (!Array.isArray(baseline[bucket])) {
      failures.push({ kind: 'invalid-baseline', message: `${bucket} must be an array` })
      continue
    }
    for (const [index, entry] of baseline[bucket].entries()) {
      const label = `${bucket}[${index}]`
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        failures.push({ kind: 'invalid-baseline', message: `${label} must be an object` })
        continue
      }
      if (typeof entry.site !== 'string' || !entry.site.trim()) {
        failures.push({ kind: 'invalid-baseline', message: `${label}.site must be a non-empty string` })
      }
      if (!Array.isArray(entry.members) || entry.members.some((member) => typeof member !== 'string')) {
        failures.push({ kind: 'invalid-baseline', message: `${label}.members must be an array of strings` })
      }
    }
  }
  if (!Array.isArray(baseline.registered) || !Array.isArray(baseline.debt)) return failures

  const seen = new Set()
  for (const entry of [...baseline.registered, ...baseline.debt]) {
    if (!entry || typeof entry.site !== 'string') continue
    if (seen.has(entry.site)) {
      failures.push({
        kind: 'invalid-baseline',
        message: `duplicate baseline owner：${entry.site}`,
      })
    }
    seen.add(entry.site)
  }
  if (baseline.converged !== undefined) {
    if (!Array.isArray(baseline.converged)) {
      failures.push({ kind: 'invalid-baseline', message: 'converged must be an array' })
    } else {
      const retiredOwners = new Set()
      for (const [index, record] of baseline.converged.entries()) {
        const label = `converged[${index}]`
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          failures.push({ kind: 'invalid-baseline', message: `${label} must be an object` })
          continue
        }
        if (!Array.isArray(record.retiredOwners) || record.retiredOwners.length === 0) {
          failures.push({ kind: 'invalid-baseline', message: `${label}.retiredOwners must be a non-empty array` })
        } else {
          const recordRetiredOwners = new Set()
          for (const [ownerIndex, site] of record.retiredOwners.entries()) {
            if (typeof site !== 'string' || !site.trim()) {
              failures.push({
                kind: 'invalid-baseline',
                message: `${label}.retiredOwners[${ownerIndex}] must be a non-empty string`,
              })
              continue
            }
            if (recordRetiredOwners.has(site)) {
              failures.push({ kind: 'invalid-baseline', message: `${label} repeats retired owner：${site}` })
            }
            recordRetiredOwners.add(site)
            if (retiredOwners.has(site)) {
              failures.push({
                kind: 'invalid-baseline',
                message: `retired owner appears in multiple convergences：${site}`,
              })
            }
            retiredOwners.add(site)
          }
        }
        if (typeof record.survivingOwner !== 'string' || !record.survivingOwner.trim()) {
          failures.push({ kind: 'invalid-baseline', message: `${label}.survivingOwner must be a non-empty string` })
        } else if (record.retiredOwners?.includes(record.survivingOwner)) {
          failures.push({
            kind: 'invalid-baseline',
            message: `${label}.survivingOwner must not also be retired：${record.survivingOwner}`,
          })
        }
      }
    }
  }
  return failures
}

function sameMembers(left, right) {
  const normalizedLeft = normalizeMembers(left ?? [])
  const normalizedRight = normalizeMembers(right ?? [])
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((member, index) => member === normalizedRight[index])
  )
}

function vocabularyIdentity(entry) {
  return `${entry.site}\u0000${normalizeMembers(entry.members ?? []).join('\u0000')}`
}

function isSubstantiveReason(value) {
  if (typeof value !== 'string') return false
  const reason = value.trim()
  return (
    reason.length >= MIN_REASON_LENGTH &&
    /\p{L}/u.test(reason) &&
    !/\b(?:TODO|TBD|FIXME)\b/.test(reason) &&
    !GENERIC_AUTHORITY_REASON.test(reason)
  )
}

function similarity(leftMembers, rightMembers) {
  const left = new Set(leftMembers)
  const right = new Set(rightMembers)
  const intersection = [...left].filter((member) => right.has(member)).length
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}

function nearestEntry(vocabulary, entries) {
  return entries
    .map((entry) => ({ entry, score: similarity(vocabulary.members, entry.members ?? []) }))
    .filter(({ score }) => score >= 0.4)
    .sort((left, right) => right.score - left.score || left.entry.site.localeCompare(right.entry.site))[0]
}

export function evaluate(vocabularies, baseline) {
  const baselineFailures = validateBaseline(baseline)
  if (baselineFailures.length > 0) return baselineFailures
  const entries = baselineEntries(baseline)
  const currentBySite = new Map(vocabularies.map((vocabulary) => [vocabulary.site, vocabulary]))
  const entryBySite = new Map(entries.map((entry) => [entry.site, entry]))
  const failures = []

  for (const record of baseline.converged ?? []) {
    // Retired sites must be gone from the live scan; otherwise this is a claim
    // about a rename or duplicate, not evidence of a completed convergence.
    for (const retiredOwner of record.retiredOwners) {
      if (currentBySite.has(retiredOwner)) {
        failures.push({
          kind: 'convergence-retired-present',
          retiredOwner,
          survivingOwner: record.survivingOwner,
        })
      }
    }
    // The survivor must still be discoverable, or the record would explain a
    // reduction with no live owner receiving the vocabulary.
    if (!currentBySite.has(record.survivingOwner)) {
      failures.push({ kind: 'convergence-surviving-absent', survivingOwner: record.survivingOwner })
    }
    // A convergence record explains provenance only; ownership still requires
    // the normal registered bucket and its substantive reason check below.
    const survivingEntry = baseline.registered.find((entry) => entry.site === record.survivingOwner)
    if (!survivingEntry) {
      failures.push({ kind: 'convergence-surviving-not-registered', survivingOwner: record.survivingOwner })
    }
  }

  const unregistered = vocabularies.filter((vocabulary) => !entryBySite.has(vocabulary.site))
  const stale = entries.filter((entry) => !currentBySite.has(entry.site))
  const pairedCurrentSites = new Set()
  const pairedBaselineSites = new Set()

  for (const entry of stale) {
    const moved = unregistered.find(
      (vocabulary) => !pairedCurrentSites.has(vocabulary.site) && sameMembers(vocabulary.members, entry.members),
    )
    if (!moved) continue
    pairedCurrentSites.add(moved.site)
    pairedBaselineSites.add(entry.site)
    failures.push({ kind: 'owner-moved', entry, vocabulary: moved })
  }

  for (const vocabulary of unregistered) {
    if (pairedCurrentSites.has(vocabulary.site)) continue
    failures.push({
      ...vocabulary,
      vocabularyKind: vocabulary.kind,
      kind: 'unregistered',
      near: nearestEntry(vocabulary, entries),
    })
  }

  for (const entry of stale) {
    if (!pairedBaselineSites.has(entry.site)) failures.push({ kind: 'stale', entry })
  }

  for (const entry of entries) {
    const current = currentBySite.get(entry.site)
    if (current && !sameMembers(current.members, entry.members)) {
      failures.push({ kind: 'member-drift', entry, vocabulary: current })
    }
    if (!isSubstantiveReason(entry.reason)) failures.push({ kind: 'no-reason', entry })
  }

  const debtCap = Number(baseline.debtCap ?? 0)
  const debtCount = baseline.debt?.length ?? 0
  if (debtCount > debtCap) failures.push({ kind: 'debt-grew', debtCount, debtCap })
  if (debtCount < debtCap) failures.push({ kind: 'debt-cap-loose', debtCount, debtCap })

  return failures
}

export function evaluateHistoricalRatchet(vocabularies, baseline, referenceBaseline, referenceLabel) {
  const referenceFailures = validateBaseline(referenceBaseline)
  if (referenceFailures.length > 0) {
    return referenceFailures.map((failure) => ({
      kind: 'invalid-reference-baseline',
      message: failure.message,
      referenceLabel,
    }))
  }

  const failures = []
  const currentVocabularySites = new Set(vocabularies.map((vocabulary) => vocabulary.site))
  const currentDebtIdentities = new Set((baseline.debt ?? []).map(vocabularyIdentity))
  const currentRegistered = baseline.registered ?? []
  const referenceDebt = referenceBaseline.debt ?? []
  const referenceDebtIdentities = new Set(referenceDebt.map(vocabularyIdentity))
  const referenceRegistered = referenceBaseline.registered ?? []
  const referenceRegisteredIdentities = new Set(referenceRegistered.map(vocabularyIdentity))
  const consumedRetiredCanonicalSites = new Set()
  const consumedReplacementCanonicalSites = new Set()

  const validConvergenceByRetiredSite = new Map()
  const referenceEntriesBySite = new Map(baselineEntries(referenceBaseline).map((entry) => [entry.site, entry]))
  for (const record of baseline.converged ?? []) {
    if (
      record.retiredOwners.some((site) => currentVocabularySites.has(site)) ||
      !currentVocabularySites.has(record.survivingOwner)
    ) {
      continue
    }
    const surviving = currentRegistered.find((candidate) => candidate.site === record.survivingOwner)
    // A retired site must be present in the old ledger; otherwise the record
    // could invent history for an owner that was never part of the ratchet.
    const missingReferenceOwner = record.retiredOwners.find((site) => !referenceEntriesBySite.has(site))
    if (missingReferenceOwner) {
      failures.push({
        kind: 'convergence-retired-unreferenced',
        retiredOwner: missingReferenceOwner,
        survivingOwner: record.survivingOwner,
        referenceLabel,
      })
      continue
    }
    if (!surviving || !isSubstantiveReason(surviving.reason)) continue
    // Matching normalized members proves this record explains this vocabulary,
    // rather than granting a same-site/name-independent promotion exception.
    const mismatchedReferenceOwner = record.retiredOwners.find(
      (site) => !sameMembers(referenceEntriesBySite.get(site).members, surviving.members),
    )
    if (mismatchedReferenceOwner) {
      failures.push({
        kind: 'convergence-members-mismatch',
        retiredOwner: mismatchedReferenceOwner,
        survivingOwner: record.survivingOwner,
        referenceLabel,
      })
      continue
    }
    for (const retiredOwner of record.retiredOwners) {
      validConvergenceByRetiredSite.set(retiredOwner, record.survivingOwner)
    }
  }

  if (baseline.debtCap > referenceBaseline.debtCap) {
    failures.push({
      kind: 'historical-cap-increased',
      currentCap: baseline.debtCap,
      referenceCap: referenceBaseline.debtCap,
      referenceLabel,
    })
  }

  for (const entry of baseline.debt ?? []) {
    if (!referenceDebtIdentities.has(vocabularyIdentity(entry))) {
      failures.push({ kind: 'historical-new-debt', entry, referenceLabel })
    }
  }

  for (const entry of referenceDebt) {
    const identity = vocabularyIdentity(entry)
    const promotedAtSameSite = currentRegistered.find((candidate) => candidate.site === entry.site)
    if (promotedAtSameSite && currentVocabularySites.has(entry.site)) {
      failures.push({
        kind: 'historical-debt-promoted',
        entry,
        promoted: promotedAtSameSite,
        referenceLabel,
      })
      continue
    }
    if (currentDebtIdentities.has(identity)) continue
    const convergenceSurvivor = validConvergenceByRetiredSite.get(entry.site)
    const convergedPromotion = convergenceSurvivor
      ? currentRegistered.find(
          (candidate) => candidate.site === convergenceSurvivor && sameMembers(candidate.members, entry.members),
        )
      : undefined
    // Only an independently validated record can explain a debt reduction. The
    // regular promotion guard below remains unchanged for every other rename.
    if (convergedPromotion) continue
    const renamedPromotions = currentRegistered.filter(
      (candidate) =>
        sameMembers(candidate.members, entry.members) &&
        !referenceRegisteredIdentities.has(vocabularyIdentity(candidate)),
    )
    const replacementCanonical = renamedPromotions.find(
      (candidate) =>
        currentVocabularySites.has(candidate.site) && !consumedReplacementCanonicalSites.has(candidate.site),
    )
    const retiredCanonical = replacementCanonical
      ? referenceRegistered.find(
          (canonical) =>
            sameMembers(canonical.members, entry.members) &&
            !currentVocabularySites.has(canonical.site) &&
            !consumedRetiredCanonicalSites.has(canonical.site),
        )
      : undefined
    if (replacementCanonical && retiredCanonical) {
      consumedReplacementCanonicalSites.add(replacementCanonical.site)
      consumedRetiredCanonicalSites.add(retiredCanonical.site)
      continue
    }
    const renamedPromotion = renamedPromotions[0]
    if (renamedPromotion) {
      failures.push({
        kind: 'historical-debt-promoted',
        entry,
        promoted: renamedPromotion,
        referenceLabel,
      })
    }
  }

  if ((baseline.debt?.length ?? 0) < referenceDebt.length && baseline.debtCap !== baseline.debt.length) {
    failures.push({
      kind: 'historical-cap-not-tight',
      debtCount: baseline.debt.length,
      debtCap: baseline.debtCap,
      referenceLabel,
    })
  }

  return failures
}

function renderFailures(failures) {
  console.error('\n✖ 语义词表门岗未通过。\n')
  for (const failure of failures) {
    if (failure.kind === 'invalid-baseline') {
      console.error(`  invalid baseline：${failure.message}`)
      console.error('    → 修正 baseline 结构后再运行；配置损坏不能作为放行方式。\n')
    } else if (failure.kind === 'invalid-reference-baseline') {
      console.error(`  invalid reference baseline（${failure.referenceLabel}）：${failure.message}`)
      console.error('    → 历史快照损坏，无法证明 debt 没有回升。\n')
    } else if (failure.kind === 'unregistered') {
      console.error(`  新词表未登记：[${failure.members.join(' | ')}]`)
      console.error(`    owner：${failure.site}`)
      if (failure.near) {
        const existing = failure.near.entry
        console.error(`    existing owner：${existing.site}`)
        if (failure.near.score === 1) {
          console.error('    members are identical — reuse that owner instead of creating a second definition.')
        } else {
          const onlyNew = failure.members.filter((member) => !existing.members.includes(member))
          const onlyExisting = existing.members.filter((member) => !failure.members.includes(member))
          console.error(`    members overlap ${(failure.near.score * 100).toFixed(0)}%.`)
          if (onlyNew.length > 0) console.error(`    only new owner has：${onlyNew.join(', ')}`)
          if (onlyExisting.length > 0) console.error(`    only existing owner has：${onlyExisting.join(', ')}`)
        }
      }
      console.error('    → 先复用现有 owner；确需独立时登记并写明 reason。\n')
    } else if (failure.kind === 'convergence-retired-present') {
      console.error(`  convergence retired owner is still present：${failure.retiredOwner}`)
      console.error(`    surviving owner：${failure.survivingOwner}`)
      console.error('    → retired owners must be absent from the live source scan.\n')
    } else if (failure.kind === 'convergence-surviving-absent') {
      console.error(`  convergence surviving owner is absent：${failure.survivingOwner}`)
      console.error('    → the surviving owner must be present in the live source scan.\n')
    } else if (failure.kind === 'convergence-surviving-not-registered') {
      console.error(`  convergence surviving owner is not registered：${failure.survivingOwner}`)
      console.error('    → the surviving owner still needs a substantive registered entry.\n')
    } else if (failure.kind === 'convergence-retired-unreferenced') {
      console.error(`  convergence retired owner is absent from reference baseline：${failure.retiredOwner}`)
      console.error(`    surviving owner：${failure.survivingOwner}`)
      console.error(`    reference：${failure.referenceLabel}\n`)
    } else if (failure.kind === 'convergence-members-mismatch') {
      console.error(`  convergence members do not match the surviving owner：${failure.retiredOwner}`)
      console.error(`    surviving owner：${failure.survivingOwner}`)
      console.error(`    reference：${failure.referenceLabel}\n`)
    } else if (failure.kind === 'owner-moved') {
      console.error(`  owner moved：${failure.entry.site} → ${failure.vocabulary.site}`)
      console.error(`    members：[${failure.vocabulary.members.join(' | ')}]`)
      if (failure.entry.bucket === 'debt') {
        console.error(
          '    equal-size debt replacement is not a reduction; converge or register the new owner explicitly.',
        )
      }
      console.error('')
    } else if (failure.kind === 'stale') {
      console.error(`  stale baseline owner：${failure.entry.site}`)
      console.error('    → 删除已消失的登记；不要让 baseline 变成失真的第二份清单。\n')
    } else if (failure.kind === 'member-drift') {
      const before = normalizeMembers(failure.entry.members ?? [])
      const after = failure.vocabulary.members
      const added = after.filter((member) => !before.includes(member))
      const removed = before.filter((member) => !after.includes(member))
      console.error(`  members changed：${failure.entry.site}`)
      if (added.length > 0) console.error(`    added：${added.join(', ')}`)
      if (removed.length > 0) console.error(`    removed：${removed.join(', ')}`)
      console.error('    → 成员变化必须审查后显式更新 baseline。\n')
    } else if (failure.kind === 'no-reason') {
      console.error(`  reason is missing or not substantive（${failure.entry.bucket}）：${failure.entry.site}`)
      console.error(
        `    reason must be a substantive string（至少 ${MIN_REASON_LENGTH} 个字符并包含文字，TODO/TBD/FIXME 不算）。`,
      )
      console.error('    → 写清为什么不能复用已有 owner；写不出理由就应合并。\n')
    } else if (failure.kind === 'debt-grew') {
      console.error(`  debt grew：${failure.debtCount} > cap ${failure.debtCap}`)
      console.error('    → debt 棘轮只减不增；新定义必须复用或登记为有意独立。\n')
    } else if (failure.kind === 'debt-cap-loose') {
      console.error(`  debt cap is not tight：${failure.debtCap} != current debt ${failure.debtCount}`)
      console.error(
        '    → current debt cap must equal the current debt count; reductions must tighten it immediately.\n',
      )
    } else if (failure.kind === 'historical-cap-increased') {
      console.error(`  historical debt cap increased：${failure.currentCap} > ${failure.referenceCap}`)
      console.error(`    reference：${failure.referenceLabel}\n`)
    } else if (failure.kind === 'historical-new-debt') {
      console.error(`  historical new debt site：${failure.entry.site}`)
      console.error(`    members：[${normalizeMembers(failure.entry.members).join(' | ')}]`)
      console.error(`    reference：${failure.referenceLabel}\n`)
    } else if (failure.kind === 'historical-debt-promoted') {
      console.error(`  historical debt reclassified as registered：${failure.entry.site}`)
      if (failure.promoted.site !== failure.entry.site) {
        console.error(`    renamed promotion：${failure.promoted.site}`)
      }
      console.error(`    reference：${failure.referenceLabel}\n`)
    } else if (failure.kind === 'historical-cap-not-tight') {
      console.error(`  historical debt reduction must tighten cap：${failure.debtCap} != ${failure.debtCount}`)
      console.error(`    reference：${failure.referenceLabel}\n`)
    } else if (failure.kind === 'reference-unavailable') {
      console.error(`  historical reference unavailable：${failure.message}`)
      console.error('    → 无法证明 debt 棘轮时 fail closed；补齐 Git 历史或显式 reference。\n')
    }
  }
}

export function run({
  repoRoot,
  baselinePath,
  updateBaseline = false,
  referenceBaselinePath = null,
  environment = process.env,
}) {
  const vocabularies = scanRepository(repoRoot)
  let baseline = loadBaseline(baselinePath)
  const baselineFailures = validateBaseline(baseline)
  if (baselineFailures.length > 0) {
    renderFailures(baselineFailures)
    return 1
  }
  if (updateBaseline) {
    baseline = writePendingEntries(baselinePath, baseline, vocabularies)
    console.log(`已更新 ${path.relative(repoRoot, baselinePath)}；新增 owner 保持 TODO，解释清楚前门岗仍会失败。`)
  }
  const resolution = resolveReferenceBaselines({
    repoRoot,
    baselinePath,
    referenceBaselinePath,
    environment,
  })
  const failures = evaluate(vocabularies, baseline)
  for (const message of resolution.errors) {
    failures.push({ kind: 'reference-unavailable', message })
  }
  if (resolution.references.length === 0 && !resolution.seed && resolution.errors.length === 0) {
    failures.push({
      kind: 'reference-unavailable',
      message: resolution.seedReason ?? 'no historical baseline could be resolved',
    })
  }
  for (const reference of resolution.references) {
    failures.push(...evaluateHistoricalRatchet(vocabularies, baseline, reference.baseline, reference.label))
  }
  if (failures.length > 0) {
    renderFailures(failures)
    return 1
  }
  if (resolution.references.length > 0) {
    console.log(
      `✓ historical debt ratchet checked against ${resolution.references.map(({ label }) => label).join(', ')}.`,
    )
  } else {
    console.log(`⚠ historical debt ratchet seed：${resolution.seedReason}；本次只校验当前快照。`)
  }
  console.log(`✓ 语义词表门岗通过：${vocabularies.length} 个 owner 全部已登记。`)
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  const repoRoot = path.resolve(readOption(argv, '--repo-root', process.cwd()))
  const baselinePath = path.resolve(
    readOption(argv, '--baseline', path.join(repoRoot, 'scripts/vocabularies-baseline.json')),
  )
  const referenceBaselineOption = readOption(argv, '--reference-baseline', null)
  const referenceBaselinePath = referenceBaselineOption ? path.resolve(referenceBaselineOption) : null
  process.exitCode = run({
    repoRoot,
    baselinePath,
    referenceBaselinePath,
    updateBaseline: argv.includes('--update-baseline'),
  })
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
