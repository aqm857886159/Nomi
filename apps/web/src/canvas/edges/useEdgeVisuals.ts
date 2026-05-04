import { useMantineTheme } from '@mantine/core'
import { useMemo, type CSSProperties } from 'react'

type EdgeKind = 'image' | 'audio' | 'subtitle' | 'video' | 'any'

function normalizeEdgeType(type?: string | null): EdgeKind {
  if (!type) return 'any'
  const normalized = type.toLowerCase()
  if (normalized === 'image' || normalized === 'audio' || normalized === 'subtitle' || normalized === 'video') {
    return normalized
  }
  return 'any'
}

export function useEdgeVisuals(type?: string | null) {
  const theme = useMantineTheme()

  return useMemo(() => {
    const edgeType = normalizeEdgeType(type)
    const rgba = (color: string, alpha: number) => {
      if (typeof theme.fn?.rgba === 'function') return theme.fn.rgba(color, alpha)
      return color
    }

    // Match infinite-creative-canvas: subtle, uniform edge stroke.
    const edgeStroke = 'rgba(15,23,42,0.82)'

    const palette: Record<EdgeKind, string> = {
      image: theme.colors.blue[6],
      audio: theme.colors.teal[5],
      subtitle: theme.colors.yellow[6],
      video: theme.colors.violet[5],
      any: theme.colors.dark[4],
    }

    const baseStroke = palette[edgeType]
    const stroke = edgeStroke

    const edgeStyle: CSSProperties = {
      stroke,
      strokeWidth: 2,
      opacity: 1,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }

    const labelStyle = {
      color: theme.colors.dark[6],
      background: 'rgba(255,255,255,0.92)',
      borderColor: stroke,
      boxShadow: '0 4px 12px rgba(15,23,42,0.12)',
    }

    const directionTextColor = theme.colors.dark[8]
    const directionChipStyle: CSSProperties = {
      background: `linear-gradient(90deg, ${rgba(baseStroke, 0.7)} 0%, ${rgba(baseStroke, 0.98)} 100%)`,
      color: directionTextColor,
      border: `1px solid ${rgba(baseStroke, 0.6)}`,
      boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
      padding: '4px 10px',
      borderRadius: 14,
      fontWeight: 700,
      letterSpacing: 0.2,
    }

    const startCapColor = rgba(baseStroke, 0.75)
    const endCapColor = rgba(baseStroke, 0.65)

    return { stroke, edgeStyle, labelStyle, isLight: true, directionChipStyle, startCapColor, endCapColor }
  }, [theme, type])
}
