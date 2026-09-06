const journey = (id, capability, script, dimensions, persistence, restart, visual, boundaryMock) => ({
  id,
  capability,
  command: { command: 'node', args: [script], kind: 'real-electron-journey' },
  boundaryMock,
  provider: {
    loopback: { state: 'loopback', evidence: 'deterministic local boundary only' },
    live: {
      state: 'blocked',
      reason: 'live provider credentials and explicit spend authorization are not supplied by this gate',
    },
  },
  dimensions,
  persistence,
  restart,
  visual,
})

const ready = (evidence) => ({ status: 'ready', evidence })

export const REAL_USER_TEST_MANIFEST = Object.freeze({
  schemaVersion: 1,
  dimensions: ['H', 'B', 'E', 'T', 'N'],
  journeys: [
    journey(
      'resident-composer-receipt',
      'resident-composer.receipt',
      'tests/ux/resident-composer-receipt-fix.e2e.mjs',
      {
        H: ready('visible Resident Composer intent → real Agent proposal → user approval → document effect'),
        B: ready('empty Composer input is disabled and Unicode survives the real project path'),
        E: ready('user refusal returns a denied tool result without mutating the document'),
        T: ready('bounded real waits and cold restart preserve the proposal/receipt boundary'),
        N: ready('real MCP stdio reaches the same project-bound write and receipt revision'),
      },
      { status: 'required', evidence: 'project document and durable proposal receipt are read from disk' },
      { status: 'required', evidence: 'a second Electron process reads both approved writes back' },
      { status: 'not-applicable', reason: 'this journey records real UI state but does not claim visual acceptance' },
      'model HTTP loopback only; no paid provider call',
    ),
    journey(
      'storyboard-agent-canonical',
      'storyboard-agent.canonical-patch',
      'tests/ux/storyboard-agent-canonical-patch.e2e.mjs',
      {
        H: ready('nomi_canvas_edit(operation=patch_shots) changes only the selected storyboard row'),
        B: ready('untouched rows and unmentioned selected-row fields remain unchanged'),
        E: ready('real MCP elicitation and canonical receipt path reject unsafe writes'),
        T: ready('the persisted canonical operation survives a cold Electron restart'),
        N: ready('the public canonical MCP tool is used, not a legacy direct patch tool or probe'),
      },
      { status: 'required', evidence: 'project payload and committed proposal receipt are read from disk' },
      { status: 'required', evidence: 'cold Electron restart reads the patched storyboard and same receipt' },
      {
        status: 'not-applicable',
        reason: 'no screenshot or visual acceptance is claimed by this canonical data-path journey',
      },
      'no provider call; real MCP stdio and Electron are exercised',
    ),
    journey(
      'production-mcp',
      'production-mcp.run',
      'tests/ux/production-mcp-journey.e2e.mjs',
      {
        H: ready('real MCP Production Run reaches local preview and final export through GUI approvals'),
        B: ready('scoped projections, one-shot gates, zero-spend fixture, and safe artifact fields are checked'),
        E: ready('approval gates and typed MCP boundaries do not false-complete or leak provider internals'),
        T: ready('a waiting shot gate and semantic canvas state recover after a real restart'),
        N: ready('fixture keeps provider calls at zero; external live network certification remains blocked'),
      },
      { status: 'required', evidence: 'Production Run, artifacts, and final MP4 are persisted and probed' },
      { status: 'required', evidence: 'a restarted Nomi process recovers the waiting gate and canvas state' },
      { status: 'pending-review', evidence: 'real screenshots are captured; human visual review is still required' },
      'provider fixture boundary only; no provider call',
    ),
    journey(
      'mcp-l1-handshake',
      'mcp.handshake',
      'tests/ux/mcp-l1-handshake.e2e.mjs',
      Object.fromEntries(
        ['H', 'B', 'E', 'T', 'N'].map((dimension) => [
          dimension,
          ready(`MCP L1 ${dimension} assertions are executed by the existing journey`),
        ]),
      ),
      { status: 'not-applicable', reason: 'handshake-only journey creates no user-owned product artifact' },
      { status: 'not-applicable', reason: 'handshake-only journey has no product state to restart' },
      { status: 'not-applicable', reason: 'no visual acceptance is claimed by protocol handshake coverage' },
      'no provider call',
    ),
    journey(
      'mcp-l2-journeys',
      'mcp.semantic-journeys',
      'tests/ux/mcp-l2-journeys.e2e.mjs',
      Object.fromEntries(
        ['H', 'B', 'E', 'T', 'N'].map((dimension) => [
          dimension,
          ready(`MCP L2 ${dimension} assertions are executed by the existing journey`),
        ]),
      ),
      { status: 'required', evidence: 'semantic MCP journey persists its real project effects' },
      { status: 'required', evidence: 'semantic MCP journey reads durable state after restart' },
      { status: 'not-applicable', reason: 'no visual acceptance is claimed by this semantic protocol journey' },
      'provider boundary is not called',
    ),
    journey(
      'mcp-skills-integration',
      'mcp.skills',
      'tests/ux/mcp-skills-integration.e2e.mjs',
      Object.fromEntries(
        ['H', 'B', 'E', 'T', 'N'].map((dimension) => [
          dimension,
          ready(`MCP skills ${dimension} assertions are executed by the existing journey`),
        ]),
      ),
      { status: 'not-applicable', reason: 'skills/resource integration journey does not write a product project' },
      { status: 'not-applicable', reason: 'skills/resource integration journey has no product state to restart' },
      { status: 'not-applicable', reason: 'no visual acceptance is claimed by skill resource coverage' },
      'no provider call',
    ),
    journey(
      'mcp-elicitation-first',
      'mcp.elicitation',
      'tests/ux/mcp-generation-elicitation-first.e2e.mjs',
      Object.fromEntries(
        ['H', 'B', 'E', 'T', 'N'].map((dimension) => [
          dimension,
          ready(`MCP elicitation ${dimension} assertions are executed by the existing journey`),
        ]),
      ),
      {
        status: 'required',
        evidence: 'elicitation-first journey records the real approved/rejected operation boundary',
      },
      { status: 'required', evidence: 'elicitation-first journey reads the durable operation state after restart' },
      { status: 'not-applicable', reason: 'no visual acceptance is claimed by this MCP approval journey' },
      'provider transport boundary only; no paid call',
    ),
  ],
})
