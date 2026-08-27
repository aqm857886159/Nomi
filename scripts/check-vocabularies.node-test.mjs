import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { scanRepository } from './check-vocabularies.mjs'
import { cleanup, makeFixture, runChecker, vocabularyEntry } from './check-vocabularies-test-helpers.mjs'

test('AST scan finds multiline unions, z.enum, as const arrays, and Set vocabularies', () => {
  const fixture = makeFixture({
    'src/multiline.ts': `
      type Multiline =
        | "queued"
        | "running"
        | "success"
    `,
    'src/schema.tsx': `
      const StatusSchema = z.enum(["pending", "running", "completed"])
    `,
    'src/options.mts': `
      export const OPTIONS = ["idle", "running", "done"] as const
    `,
    'electron/status.cts': `
      const states = new Set(["waiting", "active", "finished"])
    `,
  })

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /src\/multiline\.ts::type:Multiline\/type-union/)
    assert.match(result.stderr, /src\/schema\.tsx::variable:StatusSchema\/z\.enum/)
    assert.match(result.stderr, /src\/options\.mts::variable:OPTIONS\/as-const/)
    assert.match(result.stderr, /electron\/status\.cts::variable:states\/set/)
  } finally {
    cleanup(fixture)
  }
})

test('scan treats a Record key union as its owning type vocabulary', () => {
  const fixture = makeFixture({
    'src/statusHandlers.ts': `type StatusHandlers = Record<'idle' | 'running', () => void>`,
  })

  try {
    assert.deepEqual(scanRepository(fixture.root), [
      {
        site: 'src/statusHandlers.ts::type:StatusHandlers/type-union',
        members: ['idle', 'running'],
        kind: 'type-union',
      },
    ])
  } finally {
    cleanup(fixture)
  }
})

test('scan uses lifecycle members or semantic owner names without opening every string enum', () => {
  const fixture = makeFixture({
    'electron/capabilityCore/mcpConfig.ts': `
      export type McpConfigState =
        | 'absent'
        | 'current'
        | 'development'
        | 'legacy-launcher'
        | 'stale-development'
        | 'auth-stale'
        | 'launcher-stale'
        | 'custom'
    `,
    'src/desktop/mcpBridgeTypes.ts': `
      export type McpConfigState =
        | 'absent'
        | 'current'
        | 'development'
        | 'legacy-launcher'
        | 'stale-development'
        | 'auth-stale'
        | 'launcher-stale'
        | 'custom'
    `,
    'electron/ai/onboarding/vendorHealth.ts': `
      export type VendorHealthState = "reachable" | "unreachable" | "unsupported"
    `,
    'src/desktop/onboardingBridgeTypes.ts': `
      export type VendorHealthState = 'reachable' | 'unreachable' | 'unsupported'
    `,
    'src/jobs.ts': `
      type JobState = 'QUEUED' | 'RUNNING'
      type GenuineState = 'alpha' | 'beta'
      type NullableStatus = 'idle' | 'ready' | null | undefined
      type StatementKind = 'select' | 'insert'
      type ProgressLocale = 'en' | 'zh-CN'
      type OpenStatus = 'queued' | 'running' | string
      type FileFormat = 'mp4' | 'mov'
      type CanvasSize = 'small' | 'large'
      type StateProjection = Omit<{ width: number; height: number }, 'width' | 'height'>
      type StateMap = Record<string, 'idle' | 'ready'>
    `,
  })

  try {
    const vocabularies = scanRepository(fixture.root)
    const bySite = new Map(vocabularies.map((vocabulary) => [vocabulary.site, vocabulary]))
    for (const site of [
      'electron/capabilityCore/mcpConfig.ts::type:McpConfigState/type-union',
      'src/desktop/mcpBridgeTypes.ts::type:McpConfigState/type-union',
      'electron/ai/onboarding/vendorHealth.ts::type:VendorHealthState/type-union',
      'src/desktop/onboardingBridgeTypes.ts::type:VendorHealthState/type-union',
      'src/jobs.ts::type:JobState/type-union',
      'src/jobs.ts::type:GenuineState/type-union',
      'src/jobs.ts::type:NullableStatus/type-union',
      'src/jobs.ts::type:StateMap/type-union',
    ]) {
      assert.equal(bySite.has(site), true, site)
    }
    assert.deepEqual(bySite.get('src/jobs.ts::type:JobState/type-union')?.members, ['QUEUED', 'RUNNING'])
    assert.equal(bySite.has('src/jobs.ts::type:OpenStatus/type-union'), false)
    assert.equal(bySite.has('src/jobs.ts::type:FileFormat/type-union'), false)
    assert.equal(bySite.has('src/jobs.ts::type:CanvasSize/type-union'), false)
    assert.equal(bySite.has('src/jobs.ts::type:StateProjection/type-union'), false)
    assert.equal(bySite.has('src/jobs.ts::type:StatementKind/type-union'), false)
    assert.equal(bySite.has('src/jobs.ts::type:ProgressLocale/type-union'), false)
  } finally {
    cleanup(fixture)
  }
})

test('destructured owner identity ignores unrelated sibling binding fields', () => {
  const before = makeFixture({
    'src/status.ts': `
      declare const input: unknown
      function read({ status, extra }: { status: 'idle' | 'ready'; extra: string }) {}
      const { status, extra }: { status: 'idle' | 'ready'; extra: string } = input
    `,
  })
  const after = makeFixture({
    'src/status.ts': `
      declare const input: unknown
      function read({ status, unrelated, extra }: {
        status: 'idle' | 'ready'
        unrelated: boolean
        extra: string
      }) {}
      const { status, unrelated, extra }: {
        status: 'idle' | 'ready'
        unrelated: boolean
        extra: string
      } = input
    `,
  })

  try {
    const beforeSites = scanRepository(before.root).map((vocabulary) => vocabulary.site)
    const afterSites = scanRepository(after.root).map((vocabulary) => vocabulary.site)
    assert.deepEqual(afterSites, beforeSites)
    assert.deepEqual(beforeSites, [
      'src/status.ts::function:read/parameter:0/property:status/type-union',
      'src/status.ts::variable:binding/property:status/type-union',
    ])
  } finally {
    cleanup(before)
    cleanup(after)
  }
})

test('an identical second owner fails and points to the existing owner', () => {
  const fixture = makeFixture(
    {
      'src/first.ts': `type FirstStatus = 'queued' | 'running' | 'success'`,
      'src/second.ts': `type SecondStatus = 'queued' | 'running' | 'success'`,
    },
    {
      debtCap: 0,
      registered: [
        {
          site: 'src/first.ts::type:FirstStatus/type-union',
          members: ['queued', 'running', 'success'],
          reason: 'FirstStatus is the canonical execution lifecycle.',
        },
      ],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /src\/second\.ts::type:SecondStatus\/type-union/)
    assert.match(result.stderr, /existing owner：src\/first\.ts::type:FirstStatus\/type-union/)
    assert.match(result.stderr, /members are identical/)
  } finally {
    cleanup(fixture)
  }
})

test('a registered owner remains stable across whitespace-only source changes', () => {
  const fixture = makeFixture(
    {
      'src/status.ts': `

        // Moving this declaration must not churn the baseline identity.
        type Status =
          | 'success'
          | 'queued'
          | 'running'
      `,
    },
    {
      debtCap: 0,
      registered: [
        {
          site: 'src/status.ts::type:Status/type-union',
          members: ['queued', 'running', 'success'],
          reason: 'Canonical execution lifecycle shared by this subsystem.',
        },
      ],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('member drift at a registered owner fails with a set diff', () => {
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running' | 'success'` },
    {
      debtCap: 0,
      registered: [
        {
          site: 'src/status.ts::type:Status/type-union',
          members: ['failed', 'queued', 'running'],
          reason: 'Canonical execution lifecycle shared by this subsystem.',
        },
      ],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /members changed/)
    assert.match(result.stderr, /added：success/)
    assert.match(result.stderr, /removed：failed/)
  } finally {
    cleanup(fixture)
  }
})

test('a stale baseline owner fails instead of silently disappearing', () => {
  const fixture = makeFixture(
    {},
    {
      debtCap: 0,
      registered: [
        {
          site: 'src/deleted.ts::type:DeletedStatus/type-union',
          members: ['queued', 'running'],
          reason: 'This reason must not hide a deleted owner.',
        },
      ],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /stale baseline owner/)
    assert.match(result.stderr, /src\/deleted\.ts::type:DeletedStatus\/type-union/)
  } finally {
    cleanup(fixture)
  }
})

test('moving one debt owner to another fails even when debt count stays equal', () => {
  const fixture = makeFixture(
    { 'src/new.ts': `type NewStatus = 'queued' | 'running' | 'success'` },
    {
      debtCap: 1,
      registered: [],
      debt: [
        {
          site: 'src/old.ts::type:OldStatus/type-union',
          members: ['queued', 'running', 'success'],
          reason: 'Legacy owner scheduled for convergence.',
        },
      ],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /owner moved/)
    assert.match(result.stderr, /equal-size debt replacement is not a reduction/)
    assert.match(result.stderr, /src\/old\.ts::type:OldStatus\/type-union/)
    assert.match(result.stderr, /src\/new\.ts::type:NewStatus\/type-union/)
  } finally {
    cleanup(fixture)
  }
})

test('missing and TODO reasons fail in either baseline bucket', () => {
  const fixture = makeFixture(
    {
      'src/registered.ts': `type Registered = 'queued' | 'running'`,
      'src/debt.ts': `type Debt = 'pending' | 'failed'`,
    },
    {
      debtCap: 1,
      registered: [
        {
          site: 'src/registered.ts::type:Registered/type-union',
          members: ['queued', 'running'],
          reason: '',
        },
      ],
      debt: [
        {
          site: 'src/debt.ts::type:Debt/type-union',
          members: ['failed', 'pending'],
          reason: 'TODO: explain this debt',
        },
      ],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /reason is missing.*Registered/s)
    assert.match(result.stderr, /reason is missing.*Debt/s)
  } finally {
    cleanup(fixture)
  }
})

test('standalone TODO, TBD, and FIXME markers fail anywhere in a reason', async (t) => {
  const cases = [
    'Canonical owner today; TODO consolidate this later.',
    'TBD after the transport migration reaches production.',
    'Known compatibility owner (FIXME remove after convergence).',
  ]

  for (const reason of cases) {
    await t.test(reason, () => {
      const fixture = makeFixture(
        { 'src/status.ts': `type Status = 'queued' | 'running'` },
        {
          debtCap: 0,
          registered: [
            {
              site: 'src/status.ts::type:Status/type-union',
              members: ['queued', 'running'],
              reason,
            },
          ],
          debt: [],
        },
      )

      try {
        const result = runChecker(fixture)
        assert.equal(result.status, 1, `${reason}: ${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, /reason is missing or not substantive/)
      } finally {
        cleanup(fixture)
      }
    })
  }
})

test('lowercase vocabulary members named todo remain valid reason prose', () => {
  const site = 'src/card.ts::type:CardStatus/type-union'
  const fixture = makeFixture(
    { 'src/card.ts': `type CardStatus = 'ok' | 'todo' | 'error'` },
    {
      debtCap: 0,
      registered: [
        vocabularyEntry(
          site,
          ['error', 'ok', 'todo'],
          'CardStatus uses ok, todo, and error to drive the shared card badge presentation.',
        ),
      ],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('debt entries above the ratchet cap fail', () => {
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'failed'` },
    {
      debtCap: 0,
      registered: [],
      debt: [
        {
          site: 'src/status.ts::type:Status/type-union',
          members: ['failed', 'queued'],
          reason: 'Legacy owner scheduled for convergence.',
        },
      ],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /debt grew：1 > cap 0/)
  } finally {
    cleanup(fixture)
  }
})

test('update mode writes pending entries but remains red while TODO exists', () => {
  const fixture = makeFixture({
    'src/status.ts': `type Status = 'queued' | 'running' | 'success'`,
  })

  try {
    const result = runChecker(fixture, '--update-baseline')
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const updated = JSON.parse(fs.readFileSync(fixture.baselinePath, 'utf8'))
    assert.deepEqual(updated.registered, [])
    assert.deepEqual(updated.debt, [
      {
        site: 'src/status.ts::type:Status/type-union',
        members: ['queued', 'running', 'success'],
        reason: 'TODO: explain why this owner cannot reuse an existing vocabulary, or link its convergence plan',
      },
    ])
    assert.match(result.stderr, /reason is missing or not substantive/)
  } finally {
    cleanup(fixture)
  }
})

test('baseline schema rejects duplicate owners and malformed entries', async (t) => {
  await t.test('the same site cannot appear in both buckets', () => {
    const entry = {
      site: 'src/status.ts::type:Status/type-union',
      members: ['queued', 'running'],
      reason: 'A deliberately duplicated owner.',
    }
    const fixture = makeFixture(
      { 'src/status.ts': `type Status = 'queued' | 'running'` },
      { debtCap: 1, registered: [entry], debt: [entry] },
    )

    try {
      const result = runChecker(fixture)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /duplicate baseline owner/)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('site, members, and debtCap have strict shapes', () => {
    const fixture = makeFixture(
      { 'src/status.ts': `type Status = 'queued' | 'running'` },
      {
        debtCap: -1,
        registered: [
          {
            site: 'src/status.ts::type:Status/type-union',
            members: 'queued|running',
            reason: 'Wrong members shape.',
          },
        ],
        debt: [],
      },
    )

    try {
      const result = runChecker(fixture)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /invalid baseline/)
      assert.match(result.stderr, /members must be an array of strings/)
      assert.match(result.stderr, /debtCap must be a non-negative integer/)
    } finally {
      cleanup(fixture)
    }
  })
})

test('boolean, number, object, and punctuation-only reasons cannot make the gate green', async (t) => {
  const cases = [
    ['boolean', true],
    ['number', 123],
    ['object', {}],
    ['punctuation', '.'],
  ]

  for (const [label, reason] of cases) {
    await t.test(label, () => {
      const fixture = makeFixture(
        { 'src/status.ts': `type Status = 'queued' | 'running'` },
        {
          debtCap: 0,
          registered: [
            {
              site: 'src/status.ts::type:Status/type-union',
              members: ['queued', 'running'],
              reason,
            },
          ],
          debt: [],
        },
      )

      try {
        const result = runChecker(fixture)
        assert.equal(result.status, 1, `${label}: ${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, /reason must be a substantive string/)
      } finally {
        cleanup(fixture)
      }
    })
  }
})

test('the generic authoritative-owner template cannot make the gate green', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running'` },
    {
      debtCap: 0,
      registered: [
        {
          site,
          members: ['queued', 'running'],
          reason: `${site} is the intentional authoritative vocabulary for this local contract; exact copies must import or derive this owner.`,
        },
      ],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /reason is missing or not substantive/)
  } finally {
    cleanup(fixture)
  }
})
