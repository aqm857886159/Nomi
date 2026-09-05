import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMaximize, IconTrash, IconX } from '../../../../vendor/tablerIcons'
import { NomiImage } from '../../../../design/media'
import { orderedVariants, type ShotVariant } from './shotVariants'

/**
 * 历史变体抽屉（合同 v6 §2.9，2026-09-05 用户拍板）。
 *
 * 核心规则就一条：**重生成 = 往这里追加一版，画面格不动；只有在这里显式点「采用」，画面格才换。**
 * 于是"我再试一个"这件事零风险——不满意就关掉抽屉，什么都没变。
 *
 * 抄的是 Boords「看」与「定」拆成两个动作的**交互结构**，不是它的计费结构：Nomi 每次生成都真实
 * 消耗额度，我们不承诺"预览免费"（合同 §8 不做项）。抽屉降低的是心理成本，不是金钱成本。
 *
 * 每一版带模型/模式/提示词快照与它自己的 `@tag`——没被采用的变体也有 tag，
 * "这版不适合这一镜、但适合下一镜"是真实用法（§2.10）。
 */

type Props = {
  shotIndex: number
  variants: readonly ShotVariant[]
  /** 当前被采用的那一版 id（画面格显示的就是它）；缺省 = 画面格还是最初那次产出。 */
  adoptedVariantId?: string | undefined
  onAdopt: (variant: ShotVariant) => void
  onDelete?: ((variant: ShotVariant) => void) | undefined
  onOpenPreview?: ((variant: ShotVariant) => void) | undefined
  /** 「再出 3 版」：同镜连出三版**追加进抽屉**（v5 的 ×3 在这里落地——它本来就是"多看几个"，
   *  而"多看几个"在 v6 的家就是抽屉，不是画面格）。 */
  onGenerateMore?: (() => void) | undefined
  onClose: () => void
}

export default function StoryboardVariantsDrawer({
  shotIndex,
  variants,
  adoptedVariantId,
  onAdopt,
  onDelete,
  onOpenPreview,
  onGenerateMore,
  onClose,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const ordered = orderedVariants(variants)
  return (
    <div
      className="mt-2 rounded-nomi border border-nomi-line bg-nomi-paper p-2.5"
      data-storyboard-variants-drawer={shotIndex}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-caption font-medium text-nomi-ink-80">
          {t('storyboardEditor.variants.title', { index: shotIndex, count: ordered.length })}
        </span>
        <span className="min-w-0 truncate text-micro text-nomi-ink-40">{t('storyboardEditor.variants.hint')}</span>
        {onGenerateMore ? (
          <button
            type="button"
            onClick={onGenerateMore}
            className="ml-auto h-6 shrink-0 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
          >
            {t('storyboardEditor.frame.variants3')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('storyboardEditor.variants.close')}
          className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
        >
          <IconX size={14} stroke={1.8} />
        </button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {ordered.map((variant) => {
          const adopted = variant.id === adoptedVariantId
          return (
            <figure key={variant.id} className="m-0 w-[132px] shrink-0" data-storyboard-variant={variant.id}>
              <div className="relative h-[100px] overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05">
                <NomiImage
                  src={variant.url}
                  alt={t('storyboardEditor.variants.thumbAlt', { tag: variant.tag })}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span
                  className="absolute bottom-1 left-1 max-w-[calc(100%-8px)] truncate rounded-nomi-sm bg-nomi-overlay-chip px-1 text-micro text-nomi-paper"
                  data-storyboard-output-tag={variant.tag}
                >
                  @{variant.tag}
                </span>
                {adopted ? (
                  <span className="absolute right-1 top-1 rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro text-nomi-paper">
                    {t('storyboardEditor.variants.adopted')}
                  </span>
                ) : null}
              </div>
              <figcaption className="mt-1 flex flex-col gap-0.5">
                <span className="truncate text-micro text-nomi-ink-60" title={`${variant.modelLabel} · ${variant.modeLabel}`}>
                  {variant.modelLabel} · {variant.modeLabel}
                </span>
                <span className="line-clamp-2 text-micro text-nomi-ink-40" title={variant.prompt}>
                  {variant.prompt}
                </span>
                <div className="mt-0.5 flex items-center gap-1">
                  <button
                    type="button"
                    disabled={adopted}
                    onClick={() => onAdopt(variant)}
                    data-storyboard-variant-adopt={variant.id}
                    className="h-6 shrink-0 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-40"
                  >
                    {adopted ? t('storyboardEditor.variants.adopted') : t('storyboardEditor.variants.adopt')}
                  </button>
                  {onOpenPreview ? (
                    <button
                      type="button"
                      onClick={() => onOpenPreview(variant)}
                      aria-label={t('storyboardEditor.frame.zoom')}
                      className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
                    >
                      <IconMaximize size={13} stroke={1.8} />
                    </button>
                  ) : null}
                  {onDelete && !adopted ? (
                    <button
                      type="button"
                      onClick={() => onDelete(variant)}
                      aria-label={t('storyboardEditor.variants.delete')}
                      className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-workbench-danger-soft hover:text-workbench-danger"
                    >
                      <IconTrash size={13} stroke={1.6} />
                    </button>
                  ) : null}
                </div>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
