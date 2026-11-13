#!/usr/bin/env node
import { runReleaseCoreCompare } from './_releaseCoreCompare.mjs'
await runReleaseCoreCompare('paid', async (load, ...args) => {
  const { openPaidWalk } = await load('tests/ux/_paidRun.mjs')
  return openPaidWalk(...args)
})
