import type { ModType } from '@shared/types'
import { Chip } from '../ui/kit'

export const TYPE_LABEL: Record<ModType, string> = {
  archive: 'ARCHIVE',
  xl: 'XL',
  cet: 'CET',
  reds: 'REDS',
  red4ext: 'RED4EXT',
  tweak: 'TWEAK',
  redmod: 'REDMOD',
  input: 'INPUT',
  asi: 'ASI',
  framework: 'FRAMEWORK',
  other: 'FILES',
}

export function TypeChips(props: { types: ModType[] }) {
  // "other" nur zeigen, wenn sonst nichts da ist
  const list = props.types.length > 1 ? props.types.filter((t) => t !== 'other') : props.types
  return (
    <span className="chips">
      {list.map((t) => (
        <Chip key={t} tone={t === 'framework' ? 'solid' : undefined}>
          {TYPE_LABEL[t]}
        </Chip>
      ))}
    </span>
  )
}
