/**
 * 生成框「挂之前就该在内存里」的那几样数据——唯一的预热入口。
 *
 * 点一下卡就整套挂一次生成框（每张卡各挂一个，选中才挂）。挂载这一刻要用到的：模型目录（各个桶的行、健康度、
 * 供应商名、渠道 mapping）、「新建卡片默认模型」偏好、提示词库与「我的库」。以前它们都是谁挂载谁去取：
 * 第一次点卡要等 IPC（可疑点 e），渠道 mapping 每次挂载走同步 IPC（可疑点 j）。现在应用启动后在后台载一次，
 * 目录作废（接入 / 停用模型）后再载一次，挂载只读内存。
 *
 * 各自的 load 函数本来就是「内存里有就直接给、没有就载、同一时刻只有一趟」，所以这里只是把「第一次用到」
 * 提前到启动后——没载上的那一块（失败、还没回来）由各自的 load 在第一次用到时补，不需要第二条路。
 */
import React from 'react'
import { MODEL_REFRESH_EVENT, warmModelCatalog } from '../../../config/modelCatalogCache'
import { loadGenerationModelDefaults } from '../model/generationModelDefaults'
import { loadPromptLibraryItems } from '../../promptLibrary/usePromptLibrary'
import { loadUserPromptItems } from '../../promptLibrary/useUserPrompts'

export async function warmComposerResidentData(): Promise<void> {
  await Promise.allSettled([
    warmModelCatalog(),
    loadGenerationModelDefaults(),
    loadPromptLibraryItems(),
    loadUserPromptItems(),
  ])
}

/** 挂在工作台根上：启动后预热一次；目录作废（MODEL_REFRESH_EVENT 在作废之后才发）就把目录再载回内存。 */
export function useComposerResidentData(): void {
  React.useEffect(() => {
    void warmComposerResidentData()
    const rewarmCatalog = (): void => { void warmModelCatalog() }
    window.addEventListener(MODEL_REFRESH_EVENT, rewarmCatalog)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, rewarmCatalog)
  }, [])
}
