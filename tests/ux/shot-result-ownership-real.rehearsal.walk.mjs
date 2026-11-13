#!/usr/bin/env node
// 免费演练（开发构建 + 隔离资料目录 + 假服务商）：同一镜画布、分镜表各下一单，旧的那单晚到，两张付了钱的图都要落在这一镜上。
// 用法（工作树目录）：NOMI_LOCK_EXIT_LOCALE=zh-CN|en NOMI_LOCK_EXIT_OUT=<收据目录> NOMI_LOCK_EXIT_SHOTS=<截图目录> node tests/ux/shot-result-ownership-real.rehearsal.walk.mjs
// 收据：<收据目录>/<locale>-shotResultOwnershipJourney.json（status passed 才能交给付费入口）。
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { shotResultOwnershipJourney } from './_shotResultOwnershipJourney.mjs'

await runLockExitRehearsal(process.env.NOMI_LOCK_EXIT_LOCALE || 'zh-CN', shotResultOwnershipJourney)
