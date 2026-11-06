#!/usr/bin/env node
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
await runLockExitRehearsal(process.env.NOMI_LOCK_EXIT_LOCALE || 'zh-CN')
