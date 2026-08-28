// 两份词典的**键必须一一对应**。
//
// 为什么这条单独立一个门岗:i18n 的 `fallbackLng` 是 'zh-CN'——en 里缺一个键,运行时就静默回落中文。
// 这种漏译**在源码里看不见**:en 块本身一个汉字都没有,check:i18n 的可见文案扫描也照样绿,
// 只有真的把界面切到英文、并且正好走到那条分支,才会看见一句中文。故只能靠比对键集机器拦。
//
// 同时拦反向(zh 缺键 → 中文界面显英文)与 en 值里混进汉字(复制粘贴时把中文抄进了英文块)。
import { zhCN, en } from '../src/i18n/resources'

function flatten(node: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof node === 'string') {
    out.set(prefix, node)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out)
    }
  }
}

const zhKeys = new Map<string, string>()
const enKeys = new Map<string, string>()
flatten(zhCN, '', zhKeys)
flatten(en, '', enKeys)

const missingInEn = [...zhKeys.keys()].filter((key) => !enKeys.has(key))
const missingInZh = [...enKeys.keys()].filter((key) => !zhKeys.has(key))

// `common.chinese` 是语言选择器里的「简体中文」——各语言用自己的名字写自己(endonym),
// 英文界面也该显「简体中文」而不是「Simplified Chinese」,故它是唯一允许的例外。
const HAN = /[一-鿿]/
const ALLOWED_HAN_IN_EN = new Set(['common.chinese'])
const hanInEn = [...enKeys.entries()].filter(([key, value]) => HAN.test(value) && !ALLOWED_HAN_IN_EN.has(key))

const problems = missingInEn.length + missingInZh.length + hanInEn.length
if (problems === 0) {
  console.log(`i18n key-parity gate passed (${zhKeys.size} keys, zh-CN ↔ en in lockstep)`)
  process.exit(0)
}

console.error(`i18n key-parity gate failed: ${problems} problem(s)`)
for (const key of missingInEn) {
  console.error(`- missing in en (would render Chinese via fallbackLng): ${key} = ${JSON.stringify(zhKeys.get(key))}`)
}
for (const key of missingInZh) {
  console.error(`- missing in zh-CN: ${key} = ${JSON.stringify(enKeys.get(key))}`)
}
for (const [key, value] of hanInEn) {
  console.error(`- Chinese characters inside an en value: ${key} = ${JSON.stringify(value)}`)
}
process.exit(1)
