import type { TranslationKey } from '../../i18n/translationKey'
import { SINGLE_SHOT_GENERATION_MODULE_ID } from '../../../electron/shared/generationModuleId'

/**
 * 制作流程与阶段的**人话名字**——界面上唯一的翻译处。
 *
 * `playbook.name`（`generation.single-shot` / `brand.promo`）和阶段 id 是 Run 的身份，给机器认的；
 * 它们此前被原样当标签画在任务卡、任务行、制作详情和花钱确认卡上
 * （2026-09-25 用户截图里的 `generation.single-shot`）。身份照旧随数据走，显示只从这里取。
 * 不认识的身份（后来注册的 playbook / 阶段）回落到通用词，**绝不**回落到身份串本身。
 */
const PLAYBOOK_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  [SINGLE_SHOT_GENERATION_MODULE_ID]: 'generationCommon.production.playbook.shotGeneration',
  'brand.promo': 'generationCommon.production.playbook.brandPromo',
}

const STAGE_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  brief: 'generationCommon.production.stage.brief',
  direction: 'generationCommon.production.stage.direction',
  script: 'generationCommon.production.stage.script',
  storyboard: 'generationCommon.production.stage.storyboard',
  build: 'generationCommon.production.stage.build',
  generate: 'generationCommon.production.stage.generate',
  qa: 'generationCommon.production.stage.qa',
  assemble: 'generationCommon.production.stage.assemble',
  export: 'generationCommon.production.stage.export',
}

export function productionPlaybookLabelKey(playbookName: string): TranslationKey {
  return PLAYBOOK_LABEL_KEYS[playbookName.trim()] ?? 'generationCommon.production.playbook.unknown'
}

export function productionStageLabelKey(stageId: string): TranslationKey {
  return STAGE_LABEL_KEYS[stageId.trim()] ?? 'generationCommon.production.stage.unknown'
}
