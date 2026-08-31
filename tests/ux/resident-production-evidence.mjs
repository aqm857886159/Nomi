import { createHash } from 'node:crypto'

/**
 * The resident-production walk deliberately records a small, JSON-shaped
 * evidence envelope instead of handing the evaluator a Run object directly.
 * Keep this module dependency-free and deterministic: it is also used by
 * CI's no-quota contract test and must not read the filesystem or contact a
 * provider.
 */

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => Array.isArray(value) ? value : []
const nonEmptyText = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * Canonical JSON used for provider request fingerprints.
 *
 * Provider payloads are JSON values.  Sorting object keys is important here:
 * a renderer, adapter, or fixture may construct the same payload in a
 * different insertion order, but authorization must still bind to the same
 * bytes.  Undefined object members follow JSON semantics and are omitted;
 * undefined array members become null.  Unsupported values fail closed.
 */
function canonicalJson(value, stack = new Set(), inArray = false) {
  if (value === null) return 'null'
  if (value === undefined) return inArray ? 'null' : undefined
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('provider payload contains a non-finite number')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value === 'bigint') throw new TypeError('provider payload contains a bigint')
  if (typeof value !== 'object') throw new TypeError('provider payload contains a non-JSON value')
  if (stack.has(value)) throw new TypeError('provider payload contains a circular reference')

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('provider payload contains an invalid date')
    return JSON.stringify(value.toISOString())
  }

  stack.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, stack, true) ?? 'null').join(',')}]`
    }
    const entries = Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => {
        const encoded = canonicalJson(value[key], stack, false)
        return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`]
      })
    return `{${entries.join(',')}}`
  } finally {
    stack.delete(value)
  }
}

/**
 * Return the SHA-256 of the canonical provider request body.
 *
 * This intentionally has the same canonicalization rules as the production
 * authorization digest, but lives in the test/evidence seam so the evidence
 * checker cannot accidentally call a provider adapter or mutate a Run.
 */
export function providerRequestFingerprint(value) {
  const encoded = canonicalJson(value)
  return createHash('sha256').update(encoded ?? 'null', 'utf8').digest('hex')
}

function addIssue(issues, message) {
  if (!issues.includes(message)) issues.push(message)
}

function textFromJson(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed) } catch { return value }
  }
  return value
}

function requestBody(record) {
  if (!isRecord(record)) return undefined
  for (const key of ['body', 'requestBody', 'payload', 'request']) {
    if (record[key] !== undefined) return textFromJson(record[key])
  }
  return undefined
}

function containsText(value, needle, seen = new Set()) {
  if (typeof value === 'string') return value.includes(needle)
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsText(item, needle, seen))
  if (isRecord(value)) return Object.values(value).some((item) => containsText(item, needle, seen))
  return false
}

function providerTaskIdFrom(value, seen = new Set()) {
  if (!value) return ''
  if (typeof value === 'string') {
    const parsed = textFromJson(value)
    return parsed === value ? value.trim() : providerTaskIdFrom(parsed, seen)
  }
  if (typeof value !== 'object' || seen.has(value)) return ''
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = providerTaskIdFrom(item, seen)
      if (found) return found
    }
    return ''
  }
  if (!isRecord(value)) return ''
  // Prefer task-specific fields before generic response `id` fields.  A
  // provider response often has its own envelope id alongside data.task_id;
  // choosing the envelope id would make a valid receipt look unrelated.
  for (const key of ['providerTaskId', 'provider_task_id', 'taskId', 'task_id']) {
    if (nonEmptyText(value[key])) return value[key].trim()
  }
  for (const child of Object.values(value)) {
    const found = providerTaskIdFrom(child, seen)
    if (found) return found
  }
  if (nonEmptyText(value.id)) return value.id.trim()
  return ''
}

function requestTaskId(record) {
  return providerTaskIdFrom(record?.providerTaskId)
    || providerTaskIdFrom(record?.responseBody)
    || providerTaskIdFrom(record?.response)
}

function observedStatus(value, seen = new Set()) {
  if (typeof value === 'string') {
    const parsed = textFromJson(value)
    return parsed === value ? '' : observedStatus(parsed, seen)
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return ''
  seen.add(value)
  if (isRecord(value)) {
    for (const key of ['status', 'state', 'providerStatus', 'provider_status']) {
      if (nonEmptyText(value[key])) return value[key].trim().toLowerCase()
    }
    for (const key of ['responseBody', 'response', 'data', 'result', 'payload']) {
      const nested = observedStatus(value[key], seen)
      if (nested) return nested
    }
    for (const child of Object.values(value)) {
      const nested = observedStatus(child, seen)
      if (nested) return nested
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const nested = observedStatus(child, seen)
      if (nested) return nested
    }
  }
  return ''
}

function pathContainsTask(record, taskId) {
  if (!nonEmptyText(taskId) || !isRecord(record)) return false
  const path = String(record.path ?? record.url ?? '')
  return path.includes(taskId) || containsText(record.responseBody, taskId) || containsText(record.response, taskId)
}

function acceptedArtifact(artifact) {
  if (!isRecord(artifact)) return false
  const status = String(artifact.status ?? '').toLowerCase()
  const review = String(artifact.reviewStatus ?? artifact.review ?? '').toLowerCase()
  return ['adopted', 'ready', 'completed', 'approved'].includes(status)
    || ['adopted', 'approved', 'accepted'].includes(review)
}

function artifactKind(artifact) {
  return String(artifact?.kind ?? artifact?.type ?? '').trim().toLowerCase()
}

function artifactPath(artifact) {
  if (!isRecord(artifact)) return ''
  for (const key of ['projectRelativePath', 'relativePath', 'path']) {
    if (nonEmptyText(artifact[key])) return artifact[key].trim()
  }
  return ''
}

function numberValue(...values) {
  for (const value of values) {
    let number
    try { number = typeof value === 'number' ? value : Number(value) } catch { number = undefined }
    if (Number.isFinite(number)) return number
  }
  return undefined
}

function shotIdForJob(job) {
  return String(job?.shotId ?? job?.metadata?.shotId ?? job?.metadata?.shot_id ?? '').trim()
}

function expectedShotDuration(shot, job, artifact) {
  const candidate = shot?.candidate ?? shot?.contract ?? {}
  const parameters = candidate?.parameters ?? {}
  const jobParameters = job?.parameters ?? job?.contract?.parameters ?? {}
  return numberValue(
    artifact?.durationSeconds,
    job?.durationSeconds,
    jobParameters.duration,
    jobParameters.durationSeconds,
    parameters.duration,
    parameters.durationSeconds,
  )
}

function mediaForArtifact(media, artifact, job) {
  const path = artifactPath(artifact)
  const jobId = String(artifact?.jobId ?? job?.jobId ?? '').trim()
  const artifactId = String(artifact?.artifactId ?? '').trim()
  return media.find((entry) => {
    if (!isRecord(entry)) return false
    const entryPath = String(entry.path ?? entry.projectRelativePath ?? entry.relativePath ?? '').trim()
    return (path && entryPath === path)
      || (jobId && String(entry.jobId ?? '').trim() === jobId)
      || (artifactId && String(entry.artifactId ?? '').trim() === artifactId)
  })
}

function eventTypes(events) {
  return new Set(asArray(events).map((event) => String(event?.type ?? event?.name ?? '').trim().toLowerCase()))
}

function hasApprovedGateEvent(events) {
  return asArray(events).some((event) => {
    if (!isRecord(event) || !['gate.decided', 'gate_decided', 'gate.approved', 'generation.gate.approved', 'generation_gate_approved'].includes(String(event.type ?? '').toLowerCase())) return false
    return String(event.payload?.status ?? '').toLowerCase() === 'approved'
      || asArray(event.payload?.run?.gates).some((gate) => String(gate?.status ?? '').toLowerCase() === 'approved')
      || String(event.status ?? '').toLowerCase() === 'approved'
  })
}

function hasUnqualifiedCompletionClaim(text) {
  if (!nonEmptyText(text)) return false
  const value = text.trim()
  // Do not punish an honest progress message such as “已提交，正在等待审阅”.
  if (/(等待|待审|审阅|审核|尚未|未完成|处理中|进行中|仅.*演练|模拟|loopback|synthetic)/iu.test(value)) return false
  return /(?:已|已经|成功|完成).{0,16}(?:生成|粗剪|导出|交付|视频)|(?:生成|导出).{0,12}(?:成功|完成|好了|完毕)/u.test(value)
}

function findJobForArtifact(artifact, jobs) {
  const jobId = String(artifact?.jobId ?? '').trim()
  if (jobId) {
    const direct = jobs.find((job) => String(job?.jobId ?? '').trim() === jobId)
    if (direct) return direct
  }
  const shotId = String(artifact?.shotId ?? '').trim()
  if (shotId) return jobs.find((job) => shotIdForJob(job) === shotId)
  return jobs.find((job) => String(job?.status ?? '').toLowerCase() === 'adopted')
}

/**
 * Validate the causal evidence for a resident production journey.
 *
 * The return value is intentionally an array of user/action-oriented issue
 * strings rather than a boolean.  Callers can show every missing link in one
 * report, while tests can assert the particular invariant that regressed.
 * The function never mutates its input and never treats a provider response or
 * assistant sentence as proof that a domain artifact exists.
 */
export function evaluateResidentProductionEvidence(evidence) {
  const issues = []
  if (!isRecord(evidence)) return ['evidence must be an object']

  const synthetic = isRecord(evidence.synthetic) ? evidence.synthetic : null
  const isLoopback = synthetic?.mode === 'loopback' || synthetic?.providerMode === 'loopback'
  const paidCalls = numberValue(synthetic?.paidCalls)
  if (isLoopback && paidCalls !== 0) addIssue(issues, 'synthetic evidence reports paid provider calls')
  if (!isLoopback && paidCalls !== undefined && paidCalls > 1) addIssue(issues, 'more than one paid provider call was observed')
  if (isLoopback && hasUnqualifiedCompletionClaim(evidence.finalText)) {
    addIssue(issues, 'literal completion claim is not supported by synthetic provider evidence')
  }

  const run = isRecord(evidence.run) ? evidence.run : null
  if (!run) {
    addIssue(issues, 'missing ProductionRun evidence')
    return issues
  }
  const runStatus = String(run.status ?? '').toLowerCase()
  if (!['completed', 'awaiting_rough_cut_review', 'awaiting_export'].includes(runStatus)) {
    addIssue(issues, `ProductionRun status is not an observed delivery state: ${runStatus || 'missing'}`)
  }

  const shots = asArray(run.generationPlan?.shots)
  if (shots.length === 0) addIssue(issues, 'missing generation plan shots')
  const shotsById = new Map()
  for (const shot of shots) {
    const id = String(shot?.shotId ?? '').trim()
    if (!id) addIssue(issues, 'generation plan contains a shot without shotId')
    else if (shotsById.has(id)) addIssue(issues, `duplicate generation plan shot: ${id}`)
    else shotsById.set(id, shot)
    if (!isRecord(shot?.contract)) addIssue(issues, `shot ${id || '(unknown)'} is missing its frozen contract`)
  }

  const artifacts = asArray(run.artifacts)
  for (const kind of ['script', 'storyboard']) {
    const candidate = artifacts
      .filter((artifact) => artifactKind(artifact) === kind)
      .sort((left, right) => Number(right?.version ?? 0) - Number(left?.version ?? 0))[0]
    if (!candidate) addIssue(issues, `missing ${kind} artifact`)
    else if (!acceptedArtifact(candidate)) addIssue(issues, `${kind} artifact is not approved/adopted`)
  }

  const jobs = asArray(run.jobs)
  if (jobs.length === 0) addIssue(issues, 'missing ProductionRun generation jobs')
  const taskIds = new Set()
  const idempotencyKeys = new Set()
  for (const job of jobs) {
    const shotId = shotIdForJob(job)
    if (!shotId) addIssue(issues, 'generation job is missing shot identity')
    else if (!shotsById.has(shotId)) addIssue(issues, `generation job references an unknown shot: ${shotId}`)
    const taskId = String(job?.providerTaskId ?? '').trim()
    if (!taskId) addIssue(issues, `generation job ${job?.jobId ?? '(unknown)'} is missing provider task id`)
    else if (taskIds.has(taskId)) addIssue(issues, `duplicate provider task id: ${taskId}`)
    else taskIds.add(taskId)
    if (['unknown', 'submission_unknown', 'needs_reconciliation', 'unresolved'].includes(String(job?.status ?? '').toLowerCase())) {
      addIssue(issues, `unknown provider receipt/status for job ${job?.jobId ?? '(unknown)'}`)
    }
    const key = String(job?.providerIdempotencyKey ?? '').trim()
    if (!key) addIssue(issues, `generation job ${job?.jobId ?? '(unknown)'} is missing idempotency key`)
    else if (idempotencyKeys.has(key)) addIssue(issues, `duplicate provider idempotency key: ${key}`)
    else idempotencyKeys.add(key)
    const shot = shotsById.get(shotId)
    const shotContractHash = String(shot?.contract?.contractHash ?? '').trim()
    const jobContractHash = String(job?.contractHash ?? '').trim()
    if (shotContractHash && jobContractHash && shotContractHash !== jobContractHash) {
      addIssue(issues, `contract hash mismatch for job ${job?.jobId ?? '(unknown)'}`)
    }
    if (!nonEmptyText(job?.providerWirePayloadHash)) {
      addIssue(issues, `generation job ${job?.jobId ?? '(unknown)'} is missing authorized wire hash`)
    }
  }

  const requests = asArray(evidence.requests)
  const posts = requests.filter((record) => String(record?.method ?? '').toUpperCase() === 'POST'
    && /generation|generations|image|video/i.test(String(record?.path ?? record?.url ?? '')))
  if (jobs.length > 0 && posts.length !== jobs.length) {
    addIssue(issues, `provider submission count ${posts.length} does not match generation job count ${jobs.length}`)
  }
  jobs.forEach((job, index) => {
    const taskId = String(job?.providerTaskId ?? '').trim()
    const record = posts.find((candidate) => (taskId && requestTaskId(candidate) === taskId) || String(candidate?.jobId ?? '').trim() === String(job?.jobId ?? '').trim())
      ?? posts[index]
    if (!record) {
      addIssue(issues, `missing provider submission evidence for job ${job?.jobId ?? '(unknown)'}`)
      return
    }
    const expectedHash = String(job?.providerWirePayloadHash ?? '').trim().toLowerCase()
    if (!expectedHash) return
    let observedHash = ''
    try { observedHash = providerRequestFingerprint(requestBody(record)).toLowerCase() } catch {
      addIssue(issues, `provider wire hash cannot be computed for job ${job?.jobId ?? '(unknown)'}`)
      return
    }
    if (observedHash !== expectedHash) {
      addIssue(issues, `provider wire hash mismatch for job ${job?.jobId ?? '(unknown)'}`)
    }
    if (taskId && requestTaskId(record) && requestTaskId(record) !== taskId) {
      addIssue(issues, `provider task id mismatch for job ${job?.jobId ?? '(unknown)'}`)
    }
  })

  const taskQueries = asArray(evidence.taskQueries)
  for (const taskId of taskIds) {
    const query = taskQueries.find((record) => pathContainsTask(record, taskId) || requestTaskId(record) === taskId)
    if (!query) {
      addIssue(issues, `missing provider task query for ${taskId}`)
      continue
    }
    const status = observedStatus(query)
    if (['unknown', 'mystery', 'submission_unknown', 'unresolved'].includes(status)) {
      addIssue(issues, `unknown provider receipt/status for ${taskId}`)
    }
  }

  const events = asArray(evidence.events)
  const types = eventTypes(events)
  if (events.length === 0) addIssue(issues, 'missing causal ProductionRun events')
  else {
    if (!types.has('generation.plan.sealed') && !types.has('generation_plan_sealed') && !types.has('generation.plan.frozen') && !types.has('plan.sealed')) {
      addIssue(issues, 'missing sealed generation-plan event')
    }
    if (!hasApprovedGateEvent(events)) addIssue(issues, 'missing approved generation gate event')
    if (!types.has('artifact.adopted') && !types.has('artifact_adopted') && !types.has('artifact.adoption.completed')) addIssue(issues, 'missing artifact-adopted event')
  }

  const videoArtifacts = artifacts.filter((artifact) => ['video', 'image'].includes(artifactKind(artifact)) && acceptedArtifact(artifact))
  const media = asArray(evidence.media)
  if (videoArtifacts.length === 0 && jobs.length > 0) addIssue(issues, 'missing adopted media artifact')
  for (const artifact of videoArtifacts) {
    const job = findJobForArtifact(artifact, jobs)
    const shot = shotsById.get(shotIdForJob(job))
    const observed = mediaForArtifact(media, artifact, job)
    if (!observed) {
      addIssue(issues, `missing media evidence for artifact ${artifact?.artifactId ?? '(unknown)'}`)
      continue
    }
    if (observed.exists !== true) addIssue(issues, `media file does not exist for artifact ${artifact?.artifactId ?? '(unknown)'}`)
    const duration = numberValue(observed.durationSeconds, observed.duration)
    const isVideo = artifactKind(artifact) === 'video'
    if (isVideo) {
      if (!(duration > 0)) addIssue(issues, `media duration is not positive for artifact ${artifact?.artifactId ?? '(unknown)'}`)
      const expected = expectedShotDuration(shot, job, artifact)
      if (duration !== undefined && expected !== undefined && duration + 0.5 < expected * 0.8) {
        addIssue(issues, `media duration is shorter than the authorized shot for artifact ${artifact?.artifactId ?? '(unknown)'}`)
      }
    }
    const variance = numberValue(observed.visualVariance, observed.frameVariance, observed.variance)
    if (variance === undefined) addIssue(issues, `visual variance evidence is missing for artifact ${artifact?.artifactId ?? '(unknown)'}`)
    else if (!(variance > 0) || observed.uniform === true || observed.isUniform === true) addIssue(issues, `media is visually uniform for artifact ${artifact?.artifactId ?? '(unknown)'}`)
  }

  const timeline = isRecord(evidence.timeline) ? evidence.timeline : null
  const timelineArtifact = artifacts.find((artifact) => artifactKind(artifact) === 'timeline' && acceptedArtifact(artifact))
  if (!timeline || timeline.exists !== true) addIssue(issues, 'missing timeline evidence')
  else {
    const timelineDuration = numberValue(timeline.durationSeconds, timeline.duration)
    if (!(timelineDuration > 0)) addIssue(issues, 'timeline duration is not positive')
    const plannedDuration = shots.reduce((sum, shot) => sum + (numberValue(shot?.candidate?.parameters?.duration, shot?.contract?.parameters?.duration) ?? 0), 0)
    if (plannedDuration > 0 && timelineDuration !== undefined && timelineDuration + 0.5 < plannedDuration * 0.8) {
      addIssue(issues, 'timeline duration is stale or shorter than the generation plan')
    }
    const clipCount = numberValue(timeline.clipCount)
    if (clipCount !== undefined && clipCount < new Set(shots.map((shot) => String(shot?.shotId ?? '').trim()).filter(Boolean)).size) {
      addIssue(issues, 'timeline is missing planned clips')
    }
    // The long-task contract always records whether assembly consumed the
    // adopted/reworked job set.  False (or omitted) is evidence of a stale
    // timeline, even when a fixture happens not to include a retry job.
    if (timeline.reassembledAfterRetry !== true) addIssue(issues, 'timeline was not re-assembled after retry')
    if (timelineArtifact && Number(timelineArtifact.version ?? 0) > 0 && Number(timeline.latestVersion ?? 0) < Number(timelineArtifact.version)) {
      addIssue(issues, 'timeline evidence is stale relative to the adopted artifact')
    }
  }

  const exportEvidence = isRecord(evidence.export) ? evidence.export : null
  const exportArtifact = artifacts.find((artifact) => artifactKind(artifact) === 'export' && acceptedArtifact(artifact))
  if (runStatus === 'completed' || evidence.requireFinalArtifacts === true) {
    if (!exportArtifact) addIssue(issues, 'missing export artifact')
    if (!exportEvidence || exportEvidence.exists !== true) addIssue(issues, 'missing export evidence')
    else {
      const duration = numberValue(exportEvidence.durationSeconds, exportEvidence.duration)
      if (!(duration > 0)) addIssue(issues, 'export duration is not positive')
      const sidecar = exportEvidence.sidecar
      if (!isRecord(sidecar) || String(sidecar.owner ?? '').toLowerCase() !== 'production-run') {
        addIssue(issues, 'export sidecar is not owned by ProductionRun')
      } else {
        const expectedRunId = String(run.runId ?? evidence.runId ?? '').trim()
        if (expectedRunId && String(sidecar.runId ?? '').trim() !== expectedRunId) addIssue(issues, 'export sidecar run identity mismatch')
        if (!(numberValue(sidecar.output?.bytes, sidecar.bytes) > 0)) addIssue(issues, 'export sidecar has no non-empty output')
      }
      if (exportArtifact && artifactPath(exportArtifact) && nonEmptyText(exportEvidence.sidecar?.output?.relativePath)
        && artifactPath(exportArtifact) !== exportEvidence.sidecar.output.relativePath) {
        addIssue(issues, 'export path does not match the adopted export artifact')
      }
    }
  }

  return issues
}
