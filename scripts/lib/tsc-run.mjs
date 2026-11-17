import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// 2026-11-17 全配置实量：最大 tsc 4694MiB / 峰值 RSS 4922MiB；6144MiB 留约 31% 堆余量。
const TSC_HEAP_MB = 6144

export function tscCommand(args) {
  return [process.execPath, [`--max-old-space-size=${TSC_HEAP_MB}`, require.resolve('typescript/bin/tsc'), ...args]]
}
