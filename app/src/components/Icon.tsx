import type { CSSProperties } from 'react'
import {
  Add,
  ArrowLeft,
  Checkmark,
  CheckmarkFilled,
  Close,
  Download,
  Document,
  DocumentBlank,
  Folder,
  FolderDetails,
  Image,
  Launch,
  Play,
  PlayFilled,
  Renew,
  Search,
  Settings,
  Star,
  StarFilled,
  Upload,
  Warning,
  WarningFilled,
  Zip,
} from '@carbon/icons-react'

/**
 * BuildNexus iconography — Carbon icons, at Carbon's sizes.
 *
 * This is a thin name-based facade over `@carbon/icons-react` so the app has
 * one place to look up "which icon means a folder" rather than an import list
 * repeated in twenty files. The names are ours; the artwork is Carbon's.
 *
 * Carbon draws at 16, 20, 24 and 32 and BuildNexus says not to scale to other
 * sizes, so `size` snaps to the nearest of those rather than being passed
 * through. Icons take `currentColor`, so they follow the surrounding text.
 */

export type IconName =
  | 'search'
  | 'image'
  | 'folder'
  | 'folder-list'
  | 'file'
  | 'file-text'
  | 'file-image'
  | 'archive'
  | 'check'
  | 'alert'
  | 'play'
  | 'star'
  | 'upload'
  | 'download'
  | 'external'
  | 'refresh'
  | 'close'
  | 'settings'
  | 'back'
  | 'add'

export type CarbonIcon = typeof Search

/** `filled` picks the solid variant where Carbon ships one. */
const ICONS: Record<IconName, { outline: CarbonIcon; filled?: CarbonIcon }> = {
  search: { outline: Search },
  image: { outline: Image },
  folder: { outline: Folder },
  'folder-list': { outline: FolderDetails },
  file: { outline: Document },
  'file-text': { outline: DocumentBlank },
  'file-image': { outline: Image },
  archive: { outline: Zip },
  check: { outline: Checkmark, filled: CheckmarkFilled },
  alert: { outline: Warning, filled: WarningFilled },
  play: { outline: Play, filled: PlayFilled },
  star: { outline: Star, filled: StarFilled },
  upload: { outline: Upload },
  download: { outline: Download },
  external: { outline: Launch },
  refresh: { outline: Renew },
  close: { outline: Close },
  settings: { outline: Settings },
  back: { outline: ArrowLeft },
  add: { outline: Add },
}

const SIZES = [16, 20, 24, 32] as const
type CarbonSize = (typeof SIZES)[number]

/** Carbon draws at four sizes; snap to the nearest rather than scaling. */
function snap(size: number): CarbonSize {
  return SIZES.reduce(
    (best, candidate) =>
      Math.abs(candidate - size) < Math.abs(best - size) ? candidate : best,
    16 as CarbonSize,
  )
}

/**
 * The Carbon component behind a name, for the places that take an icon rather
 * than draw one — Primer's `Card.Icon`, a Button's `leadingVisual`.
 */
export function carbonIcon(name: IconName, filled = false): CarbonIcon {
  const entry = ICONS[name]
  return (filled && entry.filled) || entry.outline
}

export function Icon({
  name,
  size = 16,
  filled = false,
  className,
  style,
  title,
}: {
  name: IconName
  size?: number
  filled?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}) {
  const entry = ICONS[name]
  const Artwork = (filled && entry.filled) || entry.outline

  return (
    <Artwork
      size={snap(size)}
      className={className}
      style={{ flexShrink: 0, ...style }}
      // A lone icon carries its meaning through this label; next to a word it
      // is decoration and should stay out of the accessibility tree.
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  )
}

/**
 * A tinted square holding an icon, for the places the mockup had a large glyph.
 * Sits on `layer-accent-01` — BuildNexus separates with layers, not shadows.
 */
export function IconBadge({ name, size = 24 }: { name: IconName; size?: number }) {
  const side = snap(size) + 16
  return (
    <span
      style={{
        width: side,
        height: side,
        borderRadius: 'var(--border-radius-medium)',
        background: 'var(--layer-accent-01)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--icon-primary)',
      }}
    >
      <Icon name={name} size={size} />
    </span>
  )
}
