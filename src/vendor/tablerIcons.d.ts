declare module '@tabler/icons-react/dist/esm/icons/*' {
  import type { ComponentPropsWithoutRef, ForwardRefExoticComponent, RefAttributes } from 'react'

  type IconProps = Partial<Omit<ComponentPropsWithoutRef<'svg'>, 'stroke'>> & {
    size?: string | number
    stroke?: string | number
    title?: string
  }

  const IconComponent: ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>
  export default IconComponent
}

declare module '@tabler/icons-react/dist/esm/icons/*.mjs' {
  import type { ComponentPropsWithoutRef, ForwardRefExoticComponent, RefAttributes } from 'react'

  type IconProps = Partial<Omit<ComponentPropsWithoutRef<'svg'>, 'stroke'>> & {
    size?: string | number
    stroke?: string | number
    title?: string
  }

  const IconComponent: ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>
  export default IconComponent
}
