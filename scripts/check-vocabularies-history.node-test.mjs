import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cleanup,
  git,
  makeFixture,
  runChecker,
  vocabularyEntry,
  writeJson,
} from './check-vocabularies-test-helpers.mjs'

test('reference baseline prevents cap growth, new debt, reclassification, and untightened reduction', async (t) => {
  const sites = {
    a: 'src/a.ts::type:AStatus/type-union',
    b: 'src/b.ts::type:BStatus/type-union',
    c: 'src/c.ts::type:CStatus/type-union',
    d: 'src/d.ts::type:DStatus/type-union',
  }
  const entries = {
    a: vocabularyEntry(sites.a, ['queued', 'running']),
    b: vocabularyEntry(sites.b, ['failed', 'pending']),
    c: vocabularyEntry(sites.c, ['active', 'waiting']),
  }
  const sources = {
    a: `type AStatus = 'queued' | 'running'`,
    b: `type BStatus = 'pending' | 'failed'`,
    c: `type CStatus = 'waiting' | 'active'`,
  }
  const reference = { debtCap: 2, registered: [], debt: [entries.a, entries.b] }
  const cases = [
    {
      name: 'cap cannot increase',
      files: { 'src/a.ts': sources.a, 'src/b.ts': sources.b },
      baseline: { debtCap: 3, registered: [], debt: [entries.a, entries.b] },
      error: /historical debt cap increased/,
    },
    {
      name: 'equal-size replacement is still new debt',
      files: { 'src/a.ts': sources.a, 'src/c.ts': sources.c },
      baseline: { debtCap: 2, registered: [], debt: [entries.a, entries.c] },
      error: /historical new debt site.*src\/c\.ts/s,
    },
    {
      name: 'the identity includes normalized members, not only the site',
      files: {
        'src/a.ts': `type AStatus = 'queued' | 'completed'`,
        'src/b.ts': sources.b,
      },
      baseline: {
        debtCap: 2,
        registered: [],
        debt: [vocabularyEntry(sites.a, ['completed', 'queued']), entries.b],
      },
      error: /historical new debt site.*src\/a\.ts/s,
    },
    {
      name: 'debt cannot be relabelled registered while source remains',
      files: { 'src/a.ts': sources.a, 'src/b.ts': sources.b },
      baseline: { debtCap: 1, registered: [entries.a], debt: [entries.b] },
      error: /historical debt reclassified as registered.*src\/a\.ts/s,
    },
    {
      name: 'changing members cannot disguise registration at the same debt site',
      files: {
        'src/a.ts': `type AStatus = 'queued' | 'completed'`,
        'src/b.ts': sources.b,
      },
      baseline: {
        debtCap: 1,
        registered: [vocabularyEntry(sites.a, ['completed', 'queued'])],
        debt: [entries.b],
      },
      error: /historical debt reclassified as registered.*src\/a\.ts/s,
    },
    {
      name: 'a real reduction must tighten its cap',
      files: { 'src/a.ts': sources.a },
      baseline: { debtCap: 2, registered: [], debt: [entries.a] },
      error: /historical debt reduction must tighten cap/,
    },
    {
      name: 'renaming old debt into registered is still promotion',
      files: {
        'src/b.ts': sources.b,
        'src/c.ts': `type CStatus = 'queued' | 'running'`,
      },
      baseline: {
        debtCap: 1,
        registered: [vocabularyEntry(sites.c, ['queued', 'running'])],
        debt: [entries.b],
      },
      error: /historical debt reclassified as registered.*renamed promotion.*src\/c\.ts/s,
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const fixture = makeFixture(scenario.files, scenario.baseline)
      const referencePath = path.join(fixture.root, 'reference-baseline.json')
      writeJson(referencePath, reference)
      try {
        const result = runChecker(fixture, '--reference-baseline', referencePath)
        assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, scenario.error)
      } finally {
        cleanup(fixture)
      }
    })
  }

  await t.test('deleting debt and tightening the cap is a valid reduction', () => {
    const fixture = makeFixture({ 'src/a.ts': sources.a }, { debtCap: 1, registered: [], debt: [entries.a] })
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, reference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /historical debt ratchet checked/)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('moving an existing canonical owner to neutral shared while deleting its exact debt is valid', () => {
    const canonicalReference = {
      debtCap: 1,
      registered: [entries.a],
      debt: [vocabularyEntry(sites.b, ['queued', 'running'])],
    }
    const fixture = makeFixture(
      { 'src/c.ts': `type CStatus = 'queued' | 'running'` },
      { debtCap: 0, registered: [vocabularyEntry(sites.c, ['queued', 'running'])], debt: [] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, canonicalReference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /historical debt ratchet checked/)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('one retired canonical cannot excuse two exact-member debts', () => {
    const sharedMembers = ['queued', 'running']
    const canonicalReference = {
      debtCap: 2,
      registered: [entries.a],
      debt: [vocabularyEntry(sites.b, sharedMembers), vocabularyEntry(sites.c, sharedMembers)],
    }
    const fixture = makeFixture(
      { 'src/d.ts': `type DStatus = 'queued' | 'running'` },
      { debtCap: 0, registered: [vocabularyEntry(sites.d, sharedMembers)], debt: [] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, canonicalReference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /historical debt reclassified as registered.*src\/c\.ts/s)
    } finally {
      cleanup(fixture)
    }
  })
})

test('convergence records are explicit, live-verified, and scoped to historical owners', async (t) => {
  const sites = {
    retiredDebt: 'src/old-status.ts::type:OldStatus/type-union',
    retiredRegistered: 'src/old-schema.ts::variable:oldStatusSchema/z.enum',
    retiredDebtTwo: 'src/older-status.ts::type:OlderStatus/type-union',
    surviving: 'electron/shared/status.ts::variable:STATUS_VALUES/as-const',
  }
  const members = ['queued', 'running']
  const entries = {
    retiredDebt: vocabularyEntry(sites.retiredDebt, members),
    retiredRegistered: vocabularyEntry(sites.retiredRegistered, members),
    retiredDebtTwo: vocabularyEntry(sites.retiredDebtTwo, members),
    surviving: vocabularyEntry(sites.surviving, members, 'The shared status tuple is the single runtime and type owner.'),
  }
  const reference = {
    debtCap: 2,
    registered: [entries.retiredRegistered],
    debt: [entries.retiredDebt, entries.retiredDebtTwo],
  }
  const convergence = {
    retiredOwners: [sites.retiredDebt, sites.retiredRegistered, sites.retiredDebtTwo],
    survivingOwner: sites.surviving,
  }

  await t.test('a genuine merge passes when the record explains the retired debt owner', () => {
    const fixture = makeFixture(
      { 'electron/shared/status.ts': `const STATUS_VALUES = ['queued', 'running'] as const` },
      { debtCap: 0, registered: [entries.surviving], debt: [], converged: [convergence] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, reference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('a retired owner still in the live scan invalidates the record', () => {
    const fixture = makeFixture(
      {
        'src/old-status.ts': `type OldStatus = 'queued' | 'running'`,
        'electron/shared/status.ts': `const STATUS_VALUES = ['queued', 'running'] as const`,
      },
      { debtCap: 0, registered: [entries.surviving], debt: [], converged: [convergence] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, reference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /convergence retired owner is still present.*src\/old-status\.ts/s)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('a surviving owner absent from the live scan invalidates the record', () => {
    const fixture = makeFixture(
      {},
      { debtCap: 0, registered: [entries.surviving], debt: [], converged: [convergence] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, reference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /convergence surviving owner is absent.*electron\/shared\/status\.ts/s)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('a retired owner absent from the reference baseline invalidates the record', () => {
    const fixture = makeFixture(
      { 'electron/shared/status.ts': `const STATUS_VALUES = ['queued', 'running'] as const` },
      { debtCap: 0, registered: [entries.surviving], debt: [], converged: [convergence] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, {
      debtCap: 1,
      registered: [entries.retiredRegistered],
      debt: [entries.retiredDebtTwo],
    })
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /convergence retired owner is absent from reference baseline.*src\/old-status\.ts/s)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('a convergence record cannot grow the historical debt cap', () => {
    const fixture = makeFixture(
      { 'electron/shared/status.ts': `const STATUS_VALUES = ['queued', 'running'] as const` },
      { debtCap: 3, registered: [entries.surviving], debt: [], converged: [convergence] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, reference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /historical debt cap increased/)
    } finally {
      cleanup(fixture)
    }
  })

  await t.test('a convergence record cannot leave a reduced historical cap untightened', () => {
    const fixture = makeFixture(
      { 'electron/shared/status.ts': `const STATUS_VALUES = ['queued', 'running'] as const` },
      { debtCap: 1, registered: [entries.surviving], debt: [], converged: [convergence] },
    )
    const referencePath = path.join(fixture.root, 'reference-baseline.json')
    writeJson(referencePath, reference)
    try {
      const result = runChecker(fixture, '--reference-baseline', referencePath)
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /historical debt reduction must tighten cap/)
    } finally {
      cleanup(fixture)
    }
  })
})

test('default reference resolution reads the uncommitted baseline from HEAD', () => {
  const siteA = 'src/a.ts::type:AStatus/type-union'
  const siteB = 'src/b.ts::type:BStatus/type-union'
  const siteC = 'src/c.ts::type:CStatus/type-union'
  const entryA = vocabularyEntry(siteA, ['queued', 'running'])
  const entryB = vocabularyEntry(siteB, ['failed', 'pending'])
  const entryC = vocabularyEntry(siteC, ['active', 'waiting'])
  const fixture = makeFixture(
    {
      'src/a.ts': `type AStatus = 'queued' | 'running'`,
      'src/b.ts': `type BStatus = 'pending' | 'failed'`,
    },
    { debtCap: 2, registered: [], debt: [entryA, entryB] },
  )

  try {
    git(fixture.root, 'init', '--quiet')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'reference baseline')

    fs.rmSync(path.join(fixture.root, 'src/b.ts'))
    fs.writeFileSync(path.join(fixture.root, 'src/c.ts'), `type CStatus = 'waiting' | 'active'`)
    writeJson(fixture.baselinePath, { debtCap: 2, registered: [], debt: [entryA, entryC] })

    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /historical new debt site.*src\/c\.ts/s)
    assert.match(`${result.stdout}\n${result.stderr}`, /HEAD:baseline\.json/)
  } finally {
    cleanup(fixture)
  }
})

test('default resolution checks every available historical snapshot, not only dirty HEAD', () => {
  const siteA = 'src/a.ts::type:AStatus/type-union'
  const siteB = 'src/b.ts::type:BStatus/type-union'
  const siteC = 'src/c.ts::type:CStatus/type-union'
  const entryA = vocabularyEntry(siteA, ['queued', 'running'])
  const entryB = vocabularyEntry(siteB, ['failed', 'pending'])
  const entryC = vocabularyEntry(siteC, ['active', 'waiting'])
  const fixture = makeFixture(
    {
      'src/a.ts': `type AStatus = 'queued' | 'running'`,
      'src/b.ts': `type BStatus = 'pending' | 'failed'`,
    },
    { debtCap: 2, registered: [], debt: [entryA, entryB] },
  )

  try {
    git(fixture.root, 'init', '--quiet')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'older reference')

    fs.rmSync(path.join(fixture.root, 'src/b.ts'))
    fs.writeFileSync(path.join(fixture.root, 'src/c.ts'), `type CStatus = 'waiting' | 'active'`)
    writeJson(fixture.baselinePath, { debtCap: 2, registered: [], debt: [entryA, entryC] })
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'intermediate snapshot')

    writeJson(fixture.baselinePath, {
      debtCap: 2,
      registered: [],
      debt: [
        entryA,
        {
          ...entryC,
          reason: 'Legacy lifecycle owner with a reason-only working-tree edit.',
        },
      ],
    })

    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /historical new debt site.*src\/c\.ts/s)
    assert.match(result.stderr, /reference：HEAD\^1:baseline\.json/)
  } finally {
    cleanup(fixture)
  }
})

test('first baseline explicitly reports seed mode when no history exists', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running'` },
    {
      debtCap: 0,
      registered: [vocabularyEntry(site, ['queued', 'running'], 'Canonical lifecycle owner for this fixture.')],
      debt: [],
    },
  )

  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /historical debt ratchet.*seed/i)
  } finally {
    cleanup(fixture)
  }
})

test('a baseline introduced in the first Git snapshot is also an explicit seed', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running'` },
    {
      debtCap: 0,
      registered: [vocabularyEntry(site, ['queued', 'running'], 'Canonical lifecycle owner for this fixture.')],
      debt: [],
    },
  )

  try {
    git(fixture.root, 'init', '--quiet')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'introduce baseline')

    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /historical debt ratchet.*seed/i)
  } finally {
    cleanup(fixture)
  }
})

test('the first uncommitted baseline in an established repository is still a seed', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running'` },
    {
      debtCap: 0,
      registered: [vocabularyEntry(site, ['queued', 'running'], 'Canonical lifecycle owner for this fixture.')],
      debt: [],
    },
  )

  try {
    git(fixture.root, 'init', '--quiet')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    fs.writeFileSync(path.join(fixture.root, 'README.md'), 'repository history predates the baseline\n')
    git(fixture.root, 'add', 'README.md')
    git(fixture.root, 'commit', '--quiet', '-m', 'repository root')

    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /historical debt ratchet.*seed/i)
  } finally {
    cleanup(fixture)
  }
})

test('a synthetic PR merge with one baseline-path commit remains a seed', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const baseline = {
    debtCap: 0,
    registered: [vocabularyEntry(site, ['queued', 'running'], 'Canonical lifecycle owner for this fixture.')],
    debt: [],
  }
  const fixture = makeFixture({ 'src/status.ts': `type Status = 'queued' | 'running'` }, baseline)

  try {
    fs.rmSync(fixture.baselinePath)
    fs.rmSync(path.join(fixture.root, 'src/status.ts'))
    git(fixture.root, 'init', '--quiet', '--initial-branch=main')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    fs.writeFileSync(path.join(fixture.root, 'README.md'), 'baseline-free root\n')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'baseline-free root')

    git(fixture.root, 'checkout', '--quiet', '-b', 'feature')
    fs.writeFileSync(path.join(fixture.root, 'src/status.ts'), `type Status = 'queued' | 'running'`)
    writeJson(fixture.baselinePath, baseline)
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'introduce baseline')

    git(fixture.root, 'checkout', '--quiet', 'main')
    fs.writeFileSync(path.join(fixture.root, 'main.txt'), 'main advanced without the baseline\n')
    git(fixture.root, 'add', 'main.txt')
    git(fixture.root, 'commit', '--quiet', '-m', 'advance main')
    const baseSha = git(fixture.root, 'rev-parse', 'HEAD')
    git(fixture.root, 'merge', '--quiet', '--no-ff', 'feature', '-m', 'synthetic PR merge')

    assert.equal(git(fixture.root, 'log', '--format=%H', '--', 'baseline.json').split(/\r?\n/).length, 1)
    const result = runChecker(fixture, { env: { VOCAB_BASE_REF: baseSha } })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /historical debt ratchet.*seed/i)
  } finally {
    cleanup(fixture)
  }
})

test('an unavailable explicit base reference fails closed', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const fixture = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running'` },
    {
      debtCap: 0,
      registered: [vocabularyEntry(site, ['queued', 'running'], 'Canonical lifecycle owner for this fixture.')],
      debt: [],
    },
  )

  try {
    git(fixture.root, 'init', '--quiet')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'introduce baseline')

    const result = runChecker(fixture, { env: { VOCAB_BASE_REF: 'missing-fixture-base' } })
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /reference commit is unavailable.*VOCAB_BASE_REF=missing-fixture-base/s)
  } finally {
    cleanup(fixture)
  }
})

test('a deleted baseline cannot be recreated as a fresh seed', () => {
  const siteA = 'src/a.ts::type:AStatus/type-union'
  const siteC = 'src/c.ts::type:CStatus/type-union'
  const entryA = vocabularyEntry(siteA, ['queued', 'running'])
  const entryC = vocabularyEntry(siteC, ['active', 'waiting'])
  const fixture = makeFixture(
    { 'src/a.ts': `type AStatus = 'queued' | 'running'` },
    { debtCap: 1, registered: [], debt: [entryA] },
  )

  try {
    git(fixture.root, 'init', '--quiet')
    git(fixture.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(fixture.root, 'config', 'user.name', 'Vocabulary Gate Test')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'A: introduce baseline and debt')

    fs.rmSync(fixture.baselinePath)
    fs.rmSync(path.join(fixture.root, 'src/a.ts'))
    git(fixture.root, 'add', '-A')
    git(fixture.root, 'commit', '--quiet', '-m', 'B: remove baseline and debt')

    fs.writeFileSync(path.join(fixture.root, 'README.md'), 'baseline remains absent\n')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'C: keep baseline absent')

    fs.writeFileSync(path.join(fixture.root, 'src/c.ts'), `type CStatus = 'waiting' | 'active'`)
    writeJson(fixture.baselinePath, { debtCap: 1, registered: [], debt: [entryC] })

    const result = runChecker(fixture)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /historical reference unavailable/)
  } finally {
    cleanup(fixture)
  }
})

test('shallow Git history without an explicit base reference fails closed', () => {
  const site = 'src/status.ts::type:Status/type-union'
  const source = makeFixture(
    { 'src/status.ts': `type Status = 'queued' | 'running'` },
    {
      debtCap: 0,
      registered: [vocabularyEntry(site, ['queued', 'running'], 'Canonical lifecycle owner for this fixture.')],
      debt: [],
    },
  )
  const cloneContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vocabularies-shallow-'))
  const cloneRoot = path.join(cloneContainer, 'checkout')

  try {
    git(source.root, 'init', '--quiet', '--initial-branch=main')
    git(source.root, 'config', 'user.email', 'vocabulary-gate@example.test')
    git(source.root, 'config', 'user.name', 'Vocabulary Gate Test')
    git(source.root, 'add', '.')
    git(source.root, 'commit', '--quiet', '-m', 'reference baseline')
    git(cloneContainer, 'clone', '--quiet', '--depth=1', `file://${source.root}`, cloneRoot)

    const result = runChecker({ root: cloneRoot, baselinePath: path.join(cloneRoot, 'baseline.json') })
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /shallow Git history/)
  } finally {
    cleanup(source)
    fs.rmSync(cloneContainer, { recursive: true, force: true })
  }
})
