import React from 'react'

export function QuotedUiNames({ text }: { text: string }): React.ReactNode {
  return text.split(/(「[^」\n]+」|“[^”\n]+”)/u).map((part, index) =>
    part.startsWith('「') || part.startsWith('“')
      ? <span key={index} className="whitespace-nowrap">{part}</span>
      : part)
}
