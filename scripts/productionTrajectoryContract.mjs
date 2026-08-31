/**
 * Evidence contract for the next real MCP production run.
 *
 * This is deliberately a pure validator. The main Agent's recorder must fill
 * this envelope from MCP frames, ProductionRun projections/events and media QA;
 * it must not invent an "approved" or "passed" state. A child Agent may only
 * contribute human-simulator decisions (elicitation/click evidence), never
 * artifact contents or ProductionRun state.
 */

const REQUIRED_TOOLS = [
  'nomi_start_playbook',
  'nomi_decide_gate',
  'nomi_review_artifact',
  'nomi_materialize_storyboard',
  'nomi_approve_rough_cut',
  'nomi_read_canvas',
  'nomi_subscribe_run',
]

const REQUIRED_ARTIFACT_KINDS = ['brief', 'script', 'storyboard', 'timeline', 'export']

// A Codex/Claude/WorkBuddy run has one user-facing approval surface: the
// external Agent's MCP elicitation.  Nomi's desktop is still allowed to show
// a read-only projection (or an explicit takeover/recovery action), but a
// normal approval click must never be counted as the external user's decision.
const EXTERNAL_ORIGINS = new Set(['external', 'external-agent', 'claude', 'codex', 'cursor', 'workbuddy'])
const NORMAL_APPROVAL_CONTROLS = new Set([
  'direction-choice', 'direction-approve', 'approve-script', 'approve-storyboard',
  'materialize-confirm', 'contract-approve', 'sample-approve', 'rough-cut-approve', 'export-approve',
  'rough-cut-and-export',
])

function isExternalOrigin(trace) {
  const origin = text(
    trace?.project?.originHost
      || trace?.project?.origin?.host
      || trace?.client?.originHost
      || trace?.origin?.host,
  ).toLowerCase()
  return EXTERNAL_ORIGINS.has(origin)
}

function isNormalApprovalControl(control) {
  const value = text(control)
  return NORMAL_APPROVAL_CONTROLS.has(value) || /^shot-\d+-approve$/.test(value)
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function add(errors, condition, message) {
  if (!condition) errors.push(message)
}

function callById(calls, callId) {
  return calls.find((call) => call.callId === callId)
}

function toolCall(calls, tool, predicate = () => true) {
  return calls.find((call) => call.tool === tool && predicate(call))
}

function hasForbiddenMarker(value, path = 'trace') {
  if (!isObject(value) && !Array.isArray(value)) return null
  if (isObject(value)) {
    for (const key of ['synthetic', 'fixture', 'handWritten', 'statusOverride', 'approvedByScript', 'fakeMcp']) {
      if (value[key] === true) return `${path}.${key} must not be true`
    }
    for (const [key, child] of Object.entries(value)) {
      const found = hasForbiddenMarker(child, `${path}.${key}`)
      if (found) return found
    }
  } else {
    for (let index = 0; index < value.length; index += 1) {
      const found = hasForbiddenMarker(value[index], `${path}[${index}]`)
      if (found) return found
    }
  }
  return null
}

function validateCalls(trace, errors) {
  const calls = Array.isArray(trace.calls) ? trace.calls : []
  add(errors, calls.length > 0, 'MCP call trace is empty')
  const ids = new Set()
  for (const [index, call] of calls.entries()) {
    const label = `MCP call ${index + 1}`
    add(errors, isObject(call), `${label} is not an object`)
    if (!isObject(call)) continue
    const callId = text(call.callId)
    add(errors, Boolean(callId), `${label} missing callId`)
    add(errors, !ids.has(callId), `${label} duplicates callId ${callId}`)
    if (callId) ids.add(callId)
    add(errors, /^mcp-(stdio|rpc)$/.test(text(call.transport)), `${label} is not captured at MCP transport`)
    add(errors, text(call.resultSource) === 'production-run-service', `${label} result is not from ProductionRun service`)
    add(errors, isObject(call.request), `${label} is missing the request sent to MCP`)
    add(errors, Array.isArray(call.eventCursors) && call.eventCursors.length > 0, `${label} has no durable event cursor evidence`)
    if (Array.isArray(call.eventCursors)) {
      for (const cursor of call.eventCursors) add(errors, Number.isInteger(cursor) && cursor > 0, `${label} has invalid event cursor`)
    }
  }
  for (const required of REQUIRED_TOOLS) add(errors, calls.some((call) => call.tool === required), `MCP trajectory is missing ${required}`)
  const start = toolCall(calls, 'nomi_start_playbook')
  const direction = toolCall(calls, 'nomi_decide_gate')
  const reviews = calls.filter((call) => call.tool === 'nomi_review_artifact')
  const materialize = toolCall(calls, 'nomi_materialize_storyboard')
  const finalCut = toolCall(calls, 'nomi_approve_rough_cut')
  const canvas = toolCall(calls, 'nomi_read_canvas')
  if (start && direction) add(errors, calls.indexOf(start) < calls.indexOf(direction), 'playbook must start before direction decision')
  if (direction) {
    add(errors, direction.elicitation?.action === 'accept', 'direction decision has no accepted MCP elicitation')
    add(errors, direction.elicitation?.actorRole === 'human-simulator', 'direction decision was not made by the human-simulator child Agent')
  }
  add(errors, reviews.length >= 2, 'script and storyboard must each have a review call')
  for (const review of reviews) {
    add(errors, Number.isInteger(review.request?.expectedVersion) && review.request.expectedVersion >= 1, 'artifact review must carry expectedVersion')
    add(errors, review.humanDecision?.actorRole === 'human-simulator', 'artifact review has no human-simulator decision evidence')
    add(errors, ['desktop-click', 'mcp-elicitation'].includes(review.humanDecision?.inputSource), 'artifact review input is not a simulated user click/elicitation')
    add(errors, ['approved', 'changes_requested', 'rejected'].includes(review.request?.decision), 'artifact review has invalid decision')
  }
  if (materialize) {
    add(errors, reviews.some((review) => review.request?.decision === 'approved' && calls.indexOf(review) < calls.indexOf(materialize)), 'storyboard must be approved before materialize')
    add(errors, Number.isInteger(materialize.request?.expectedVersion) && materialize.request.expectedVersion >= 1, 'materialize must carry expected storyboard version')
  }
  if (canvas) add(errors, materialize && calls.indexOf(materialize) < calls.indexOf(canvas), 'canvas must be observed after storyboard materialize')
  if (finalCut) add(errors, materialize && calls.indexOf(materialize) < calls.indexOf(finalCut), 'rough cut/export approval must happen after materialize')
  return calls
}

function validateDecisions(trace, calls, events, errors) {
  const decisions = Array.isArray(trace.decisions) ? trace.decisions : []
  add(errors, decisions.length >= 3, 'trajectory needs direction, script review, and storyboard review decisions')
  const eventCursors = new Set(events.map((event) => event.cursor))
  const decisionIds = new Set()
  for (const [index, decision] of decisions.entries()) {
    const label = `decision ${index + 1}`
    const call = callById(calls, decision.callId)
    add(errors, isObject(decision), `${label} is not an object`)
    if (!isObject(decision)) continue
    add(errors, Boolean(text(decision.decisionId)) && !decisionIds.has(decision.decisionId), `${label} has missing or duplicate decisionId`)
    decisionIds.add(decision.decisionId)
    add(errors, Boolean(call), `${label} does not reference an MCP call`)
    add(errors, decision.actorRole === 'human-simulator', `${label} actor must be the child Agent simulating a human click`)
    add(errors, ['mcp-elicitation', 'desktop-click'].includes(decision.inputSource), `${label} must come from elicitation/click input`)
    add(errors, Number.isInteger(decision.eventCursor) && eventCursors.has(decision.eventCursor), `${label} is not anchored to a durable event cursor`)
    if (call) add(errors, call.tool === 'nomi_decide_gate' || call.tool === 'nomi_review_artifact', `${label} is not backed by a decision MCP tool`)
    if (decision.kind === 'artifact-review') {
      add(errors, Number.isInteger(decision.artifactVersion) && decision.artifactVersion >= 1, `${label} missing reviewed artifact version`)
      add(errors, Boolean(text(decision.artifactId)), `${label} missing reviewed artifact id`)
    }
  }
  return decisionIds
}

/**
 * External-agent-only policy: normal approvals must be made through the MCP
 * decision path.  Keep this check in the evidence contract (rather than in
 * the renderer/service) so a black-box observer can fail closed even if the
 * UI happens to advance the Run.  Desktop input remains valid only for an
 * explicit takeover/recovery/reconcile control, which is intentionally not a
 * normal creative/production approval.
 */
export function validateExternalApprovalSurface(trace) {
  if (!isExternalOrigin(trace)) return []
  const errors = []
  const seen = new Set()
  const report = (control, source) => {
    const value = text(control)
    if (!isNormalApprovalControl(value)) return
    const key = value
    if (seen.has(key)) return
    seen.add(key)
    errors.push(`external-agent run has forbidden normal-path desktop-click approval: ${value} (${source})`)
  }
  for (const decision of Array.isArray(trace.decisions) ? trace.decisions : []) {
    if (decision?.actorRole === 'human-simulator' && decision?.inputSource === 'desktop-click') report(decision.control, 'decision')
  }
  for (const call of Array.isArray(trace.calls) ? trace.calls : []) {
    const humanDecision = call?.humanDecision
    if (humanDecision?.actorRole === 'human-simulator' && humanDecision?.inputSource === 'desktop-click') report(humanDecision.control, 'MCP call')
  }
  return errors
}

function validateEvents(trace, errors) {
  const events = Array.isArray(trace.events) ? trace.events : []
  add(errors, events.length > 0, 'durable ProductionRun event trace is missing')
  const cursors = events.map((event) => Number(event?.cursor))
  add(errors, cursors.every((cursor, index) => Number.isInteger(cursor) && cursor > 0 && (index === 0 || cursor > cursors[index - 1])), 'durable event cursors must be strictly increasing')
  const runId = text(trace.project?.runId)
  for (const event of events) add(errors, text(event?.runId) === runId, 'event belongs to a different run')
  add(errors, events.some((event) => event.type === 'run.created'), 'durable event trace is missing run.created')
  add(errors, events.some((event) => event.type === 'gate.decided'), 'durable event trace is missing gate.decided')
  // Reducer emits artifact.adopted for approval and artifact.reviewed for a
  // change request; both are real review evidence. Do not require a made-up
  // event name that the ProductionRun reducer never writes.
  add(errors, events.some((event) => event.type === 'artifact.reviewed' || event.type === 'artifact.adopted'), 'durable event trace is missing artifact review')
  add(errors, events.some((event) => event.type === 'plan.attached'), 'durable event trace is missing plan.attached')
  // Job lifecycle is a single job.status event with status in its payload in
  // the reducer. A few older projections name the terminal event job.adopted;
  // accept both spellings but never infer adoption from an artifact alone.
  add(errors, events.some((event) => event.type === 'job.adopted' || (event.type === 'job.status' && event.payload?.status === 'adopted')), 'durable event trace is missing adopted job status')
  return events
}

function validateArtifacts(trace, calls, decisions, errors) {
  const artifacts = Array.isArray(trace.artifacts) ? trace.artifacts : []
  const kinds = new Set(artifacts.map((artifact) => artifact?.kind))
  for (const kind of REQUIRED_ARTIFACT_KINDS) add(errors, kinds.has(kind), `project is missing durable ${kind} artifact`)
  const versions = new Map()
  for (const artifact of artifacts) {
    const label = `artifact ${artifact?.artifactId || '(unknown)'}`
    add(errors, isObject(artifact), `${label} is not an object`)
    if (!isObject(artifact)) continue
    const artifactId = text(artifact.artifactId)
    const version = Number(artifact.version)
    add(errors, Boolean(artifactId), `${label} missing artifactId`)
    add(errors, Number.isInteger(version) && version >= 1, `${label} missing valid version`)
    if (artifactId && Number.isInteger(version)) {
      const prior = versions.get(artifactId) || 0
      add(errors, version > prior, `${label} version is not monotonic`)
      versions.set(artifactId, version)
    }
    add(errors, ['production-run-service', 'nomi-agent', 'external-mcp'].includes(artifact.source), `${label} has untrusted/manual source`)
    add(errors, callById(calls, artifact.sourceCallId), `${label} sourceCallId is not a captured MCP call`)
    add(errors, !pathEscapesProject(artifact.projectRelativePath), `${label} path escapes the Nomi project`)
    if (artifact.status === 'adopted' && ['script', 'storyboard'].includes(artifact.kind)) {
      add(errors, artifact.reviewStatus === 'approved', `${label} is adopted without approved review status`)
      add(errors, decisions.has(artifact.reviewDecisionId), `${label} is adopted without a linked human decision`)
      add(errors, Boolean(text(artifact.contentHash)), `${label} has no content hash`)
    }
  }
  const storyboard = artifacts.find((artifact) => artifact.kind === 'storyboard' && artifact.status === 'adopted')
  const script = artifacts.find((artifact) => artifact.kind === 'script' && artifact.status === 'adopted')
  if (storyboard && script) {
    add(errors, storyboard.sourceArtifactId === script.artifactId, 'storyboard does not derive from the adopted script')
    add(errors, Number(storyboard.sourceVersion) === Number(script.version), 'storyboard source script version is not pinned')
  }
  return artifacts
}

function pathEscapesProject(value) {
  const relative = text(value)
  return !relative || relative.startsWith('/') || relative.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(relative) || relative.split(/[\\/]+/).includes('..')
}

function validateCanvas(trace, calls, errors) {
  const canvas = trace.canvas
  add(errors, isObject(canvas), 'canvas observation is missing')
  if (!isObject(canvas)) return
  const readCall = callById(calls, canvas.sourceCallId)
  const materializeCall = callById(calls, canvas.materializeCallId)
  add(errors, readCall?.tool === 'nomi_read_canvas', 'canvas must come from nomi_read_canvas')
  add(errors, materializeCall?.tool === 'nomi_materialize_storyboard', 'canvas must link to nomi_materialize_storyboard')
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
  add(errors, nodes.length >= 6, `canvas needs at least 6 materialized shot nodes; got ${nodes.length}`)
  const ids = new Set()
  for (const node of nodes) {
    add(errors, Boolean(text(node?.nodeId)) && !ids.has(node.nodeId), 'canvas node ids must be unique')
    if (node?.nodeId) ids.add(node.nodeId)
    add(errors, Boolean(text(node?.shotId)), 'canvas video node missing shotId')
    add(errors, node?.observed === true, 'canvas node was not observed from the real canvas result')
    add(errors, node?.sourceArtifactId === 'artifact-storyboard-v1', 'canvas node lost storyboard provenance')
  }
}

function validateJobs(trace, calls, errors) {
  const jobs = Array.isArray(trace.jobs) ? trace.jobs : []
  const ids = new Set(jobs.map((job) => job?.jobId))
  const shotIds = new Set()
  const retryShotIds = new Set(jobs.filter((job) => Number(job?.retryCount) > 0 || Number(job?.attempt) > 1).map((job) => job?.shotId))
  add(errors, jobs.length >= 6, `trajectory needs at least 6 production jobs; got ${jobs.length}`)
  for (const job of jobs) {
    const label = `job ${job?.jobId || '(unknown)'}`
    add(errors, isObject(job), `${label} is not an object`)
    if (!isObject(job)) continue
    add(errors, Boolean(text(job.jobId)) && ids.has(job.jobId), `${label} missing jobId`)
    add(errors, Boolean(text(job.shotId)) && (!shotIds.has(job.shotId) || retryShotIds.has(job.shotId)), `${label} duplicates shotId unexpectedly`)
    if (job.shotId) shotIds.add(job.shotId)
    add(errors, job.source === 'run-projection', `${label} is not copied from a ProductionRun projection`)
    add(errors, Boolean(text(job.provider)) && Boolean(text(job.model)), `${label} missing provider/model identity`)
    add(errors, Boolean(text(job.providerTaskId)), `${label} missing real providerTaskId`)
    add(errors, Number.isInteger(job.attempt) && job.attempt >= 1, `${label} missing attempt number`)
    add(errors, ['adopted', 'needs_attention', 'ready'].includes(job.status), `${label} has no terminal provider status`) // rejected parents remain inspectable
    const observed = callById(calls, job.observedAtCallId)
    add(errors, ['nomi_get_run', 'nomi_subscribe_run'].includes(observed?.tool), `${label} was not observed in a real Run projection/event call`)
    if (Number(job.retryCount) > 0 || Number(job.attempt) > 1) {
      add(errors, Boolean(text(job.parentJobId)) && ids.has(job.parentJobId), `${label} retry has no existing parent job`)
      add(errors, Boolean(text(job.retryReason)), `${label} retry has no root-cause reason`)
    }
  }
}

function validateQa(trace, errors) {
  const qa = trace.qa
  add(errors, isObject(qa), 'media QA evidence is missing')
  if (!isObject(qa)) return
  add(errors, qa.source === 'frame-analysis', 'QA must come from the frame-analysis artifact')
  add(errors, qa.captureMethod === 'ffmpeg-extract-frames', 'QA has no real extracted-frame method')
  add(errors, !pathEscapesProject(qa.filmPath) && !pathEscapesProject(qa.analysisPath), 'QA paths must be project-relative')
  add(errors, qa.verdict === 'pass', 'media QA verdict is not pass')
  const shots = Array.isArray(qa.perShot) ? qa.perShot : []
  add(errors, shots.length >= 6, 'QA needs every shot, not only an MP4 probe')
  for (const shot of shots) {
    for (const frame of ['early', 'middle', 'late']) add(errors, Boolean(text(shot?.[frame])), `QA ${shot?.shotId || 'shot'} missing ${frame} frame`)
    add(errors, shot?.verdict === 'pass', `QA ${shot?.shotId || 'shot'} has not passed`)
    add(errors, Array.isArray(shot?.evidence) && shot.evidence.length > 0, `QA ${shot?.shotId || 'shot'} has no frame evidence`)
  }
  const boundaries = Array.isArray(qa.boundaries) ? qa.boundaries : []
  add(errors, boundaries.length === Math.max(0, shots.length - 1), 'QA boundary count does not match shot count')
  for (const boundary of boundaries) {
    add(errors, boundary?.verdict === 'pass', `QA boundary ${boundary?.fromShotId || '?'}→${boundary?.toShotId || '?'} has not passed`)
    add(errors, Array.isArray(boundary?.evidence) && boundary.evidence.length > 0, 'QA boundary has no contact-sheet evidence')
  }
  add(errors, qa.audio?.verdict === 'pass' && qa.audio?.audible === true, 'audio QA is not audibly proven')
  add(errors, Boolean(text(qa.audio?.waveform)), 'audio QA waveform evidence is missing')
}

function validateIterations(trace, errors) {
  const iterations = Array.isArray(trace.iterations) ? trace.iterations : []
  add(errors, iterations.length > 0, 'trajectory needs a root-cause iteration record')
  for (const iteration of iterations) {
    const label = `iteration ${iteration?.round || '?'}`
    add(errors, Number.isInteger(iteration?.round) && iteration.round >= 1, `${label} missing round number`)
    for (const field of ['failureId', 'rootCause', 'designComparison', 'fix']) add(errors, Boolean(text(iteration?.[field])), `${label} missing ${field}`)
    add(errors, Number.isInteger(iteration?.nextRound) && iteration.nextRound > iteration.round, `${label} missing nextRound`)
    add(errors, Array.isArray(iteration?.symptomEvidence) && iteration.symptomEvidence.length > 0, `${label} missing symptom evidence`)
    add(errors, Boolean(text(iteration?.retryJobId)), `${label} missing linked retry job`)
  }
}

export function validateProductionTrajectory(trace) {
  const errors = []
  if (!isObject(trace)) return { ok: false, errors: ['production trajectory is missing'] }
  const forbidden = hasForbiddenMarker(trace)
  if (forbidden) errors.push(forbidden)
  add(errors, trace.schemaVersion === 1, 'unsupported production trajectory schemaVersion')
  add(errors, trace.kind === 'nomi-production-trajectory', 'invalid production trajectory kind')
  add(errors, trace.captureMode === 'live-mcp', 'trajectory must be captured from live-mcp, not a scripted fixture')
  add(errors, trace.producer?.kind === 'production-run-service', 'trajectory producer must be ProductionRun service')
  add(errors, trace.project?.artifactRoot === 'nomi-project', 'artifacts must be rooted in the Nomi project')
  add(errors, Boolean(text(trace.project?.projectId)) && Boolean(text(trace.project?.runId)), 'projectId and runId are required')
  const calls = validateCalls(trace, errors)
  const events = validateEvents(trace, errors)
  const decisions = validateDecisions(trace, calls, events, errors)
  for (const error of validateExternalApprovalSurface(trace)) errors.push(error)
  validateArtifacts(trace, calls, decisions, errors)
  validateCanvas(trace, calls, errors)
  validateJobs(trace, calls, errors)
  validateQa(trace, errors)
  validateIterations(trace, errors)
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] }
}

/**
 * Stable counters for the main Agent's run report. These numbers are derived
 * from the same evidence envelope as the gate above; they are not self-reported
 * percentages from a model. A zero denominator intentionally yields 0, so an
 * empty/fake trace cannot look perfect through NaN/Infinity.
 */
export function measureProductionTrajectory(trace) {
  const calls = Array.isArray(trace?.calls) ? trace.calls : []
  const decisions = Array.isArray(trace?.decisions) ? trace.decisions : []
  const artifacts = Array.isArray(trace?.artifacts) ? trace.artifacts : []
  const jobs = Array.isArray(trace?.jobs) ? trace.jobs : []
  const canvasNodes = Array.isArray(trace?.canvas?.nodes) ? trace.canvas.nodes : []
  const shots = Array.isArray(trace?.qa?.perShot) ? trace.qa.perShot : []
  const boundaries = Array.isArray(trace?.qa?.boundaries) ? trace.qa.boundaries : []
  const requiredToolCount = REQUIRED_TOOLS.length
  const observedTools = new Set(calls.map((call) => call?.tool))
  const reviewedDecisions = decisions.filter((decision) => decision?.actorRole === 'human-simulator' && ['mcp-elicitation', 'desktop-click'].includes(decision?.inputSource))
  const providerJobs = jobs.filter((job) => text(job?.providerTaskId))
  const retriedJobs = jobs.filter((job) => Number(job?.retryCount) > 0 || Number(job?.attempt) > 1)
  const retriesWithLineage = retriedJobs.filter((job) => text(job?.parentJobId) && text(job?.retryReason))
  const frameSlots = shots.length * 3
  const frameEvidenceSlots = shots.reduce((count, shot) => count + ['early', 'middle', 'late'].filter((key) => text(shot?.[key]) && Array.isArray(shot?.evidence) && shot.evidence.length > 0).length, 0)
  const rootCauseIterations = Array.isArray(trace?.iterations) ? trace.iterations.filter((iteration) => text(iteration?.rootCause) && text(iteration?.designComparison) && text(iteration?.fix)).length : 0
  const requiredToolsObserved = REQUIRED_TOOLS.filter((tool) => observedTools.has(tool)).length
  return {
    mcpCallCount: calls.length,
    requiredMcpToolCoverage: requiredToolCount ? requiredToolsObserved / requiredToolCount : 0,
    userDecisionCount: reviewedDecisions.length,
    humanDecisionCoverage: decisions.length ? reviewedDecisions.length / decisions.length : 0,
    durableArtifactCount: artifacts.length,
    approvedArtifactCount: artifacts.filter((artifact) => artifact?.status === 'adopted' && artifact?.reviewStatus === 'approved').length,
    canvasShotNodeCount: canvasNodes.filter((node) => node?.observed === true && node?.kind === 'video').length,
    providerJobCount: jobs.length,
    providerTaskTraceRate: jobs.length ? providerJobs.length / jobs.length : 0,
    retryCount: retriedJobs.length,
    retryLineageRate: retriedJobs.length ? retriesWithLineage.length / retriedJobs.length : 1,
    frameEvidenceCoverage: frameSlots ? frameEvidenceSlots / frameSlots : 0,
    boundaryPassRate: boundaries.length ? boundaries.filter((boundary) => boundary?.verdict === 'pass').length / boundaries.length : 0,
    audibleAudioPass: trace?.qa?.audio?.verdict === 'pass' && trace?.qa?.audio?.audible === true,
    rootCauseIterationCount: rootCauseIterations,
    trajectoryVerdict: validateProductionTrajectory(trace).ok ? 'pass' : 'fail',
  }
}

/**
 * Small in-memory recorder for the main Agent's MCP harness. It only appends
 * observations supplied by the harness; it never fabricates run/artifact/job
 * state and never writes to the Nomi project. `snapshot()` is the object that
 * the caller persists alongside the real `.nomi` artifacts after the run.
 */
export function createProductionTrajectoryRecorder({ projectId, runId, client = {} }) {
  if (!text(projectId) || !text(runId)) throw new Error('projectId and runId are required')
  const trace = {
    schemaVersion: 1,
    kind: 'nomi-production-trajectory',
    captureMode: 'live-mcp',
    producer: { kind: 'production-run-service', source: 'Nomi' },
    client: { ...client },
    project: { projectId: text(projectId), runId: text(runId), artifactRoot: 'nomi-project' },
    calls: [], decisions: [], events: [], artifacts: [], canvas: null, jobs: [], qa: null, iterations: [],
  }
  const append = (key, value) => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new Error(`Cannot record empty ${key}`)
    trace[key].push({ ...value })
  }
  return {
    recordMcpCall: (value) => append('calls', value),
    recordDecision: (value) => append('decisions', value),
    recordEvents: (values) => {
      if (!Array.isArray(values)) throw new Error('events must be an array')
      for (const value of values) append('events', value)
    },
    recordArtifact: (value) => append('artifacts', value),
    recordCanvas: (value) => { if (!isObject(value)) throw new Error('canvas observation must be an object'); trace.canvas = structuredClone(value) },
    recordJob: (value) => append('jobs', value),
    recordQa: (value) => { if (!isObject(value)) throw new Error('QA observation must be an object'); trace.qa = structuredClone(value) },
    recordIteration: (value) => append('iterations', value),
    snapshot: () => structuredClone(trace),
    metrics: () => measureProductionTrajectory(trace),
    validate: () => validateProductionTrajectory(trace),
  }
}
