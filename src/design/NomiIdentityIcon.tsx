import { IconBox, IconPlugConnected } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { hideBrokenIdentityImage } from './identityIconUtils'

export type NomiIdentityIconSource = Readonly<{
  src?: string
  fallback?: string
  kind: 'model' | 'provider'
}>

type NomiIdentityIconProps = {
  icon: NomiIdentityIconSource
  size?: 'sm' | 'md'
  className?: string
}

/** Local-only identity mark used by compact selectors. The text/icon fallback stays behind the image. */
export function NomiIdentityIcon({ icon, size = 'sm', className }: NomiIdentityIconProps): JSX.Element {
  const fallback = icon.fallback?.trim().slice(0, 2)
  const pixels = size === 'md' ? 18 : 16
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-60',
        size === 'sm' ? 'size-4' : '',
        className,
      )}
      style={size === 'md' ? { width: pixels, height: pixels } : undefined}
    >
      {fallback ? (
        <span className="text-micro font-semibold leading-none">{fallback}</span>
      ) : icon.kind === 'provider' ? (
        <IconPlugConnected size={pixels - 5} stroke={1.7} />
      ) : (
        <IconBox size={pixels - 5} stroke={1.7} />
      )}
      {icon.src ? (
        <img
          src={icon.src}
          alt=""
          className="absolute inset-0 size-full bg-nomi-paper object-contain"
          onError={(event) => hideBrokenIdentityImage(event.currentTarget)}
        />
      ) : null}
    </span>
  )
}
