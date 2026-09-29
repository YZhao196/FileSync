import type { CSSProperties, ReactNode } from 'react'

/**
 * Line icons on a 16×16 grid, drawn in `currentColor` so they inherit the
 * surrounding text colour in both themes. Deliberately dependency-free — an
 * icon package would be ~10× the size for this many glyphs.
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

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.15 10.15 13.75 13.75" />
    </>
  ),
  image: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <circle cx="5.6" cy="6.3" r="1" />
      <path d="M2.2 11.4 5.8 7.8l2.3 2.3 2.3-2.3 3.4 3.4" />
    </>
  ),
  folder: (
    <path d="M1.75 4.6A1.6 1.6 0 0 1 3.35 3h2.3a1.1 1.1 0 0 1 .88.44L7.4 4.9h5.25a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6h-9.3a1.6 1.6 0 0 1-1.6-1.6z" />
  ),
  'folder-list': (
    <>
      <path d="M1.75 4.6A1.6 1.6 0 0 1 3.35 3h2.3a1.1 1.1 0 0 1 .88.44L7.4 4.9h5.25a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6h-9.3a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M5 8h6M5 10.2h3.6" />
    </>
  ),
  file: (
    <>
      <path d="M3.9 2.5A1.4 1.4 0 0 1 5.3 1.1h3.4l3.5 3.5v8.9a1.4 1.4 0 0 1-1.4 1.4H5.3a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M8.6 1.5v3.3h3.3" />
    </>
  ),
  'file-text': (
    <>
      <path d="M3.9 2.5A1.4 1.4 0 0 1 5.3 1.1h3.4l3.5 3.5v8.9a1.4 1.4 0 0 1-1.4 1.4H5.3a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M8.6 1.5v3.3h3.3" />
      <path d="M5.9 8.6h4.2M5.9 10.8h2.8" />
    </>
  ),
  'file-image': (
    <>
      <path d="M3.9 2.5A1.4 1.4 0 0 1 5.3 1.1h3.4l3.5 3.5v8.9a1.4 1.4 0 0 1-1.4 1.4H5.3a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M8.6 1.5v3.3h3.3" />
      <path d="m5.5 11.7 1.7-1.7 1.2 1.2 1-1 1.3 1.3" />
    </>
  ),
  archive: (
    <>
      <rect x="1.9" y="2.6" width="12.2" height="3.3" rx="1" />
      <path d="M3.1 5.9v6a1.5 1.5 0 0 0 1.5 1.5h6.8a1.5 1.5 0 0 0 1.5-1.5v-6" />
      <path d="M6.6 8.9h2.8" />
    </>
  ),
  check: <path d="M3.2 8.4 6.3 11.5 12.8 5" />,
  alert: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <path d="M8 4.9v3.7M8 10.9v.05" />
    </>
  ),
  play: <path d="M5.4 3.6 12.1 8l-6.7 4.4z" />,
  star: <path d="m8 1.9 1.85 3.75 4.15.6-3 2.93.71 4.12L8 11.35l-3.71 1.95.71-4.12-3-2.93 4.15-.6z" />,
  upload: (
    <>
      <path d="M8 10.8V2.9" />
      <path d="M4.9 6 8 2.9 11.1 6" />
      <path d="M2.9 13h10.2" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.9v7.9" />
      <path d="M4.9 7.8 8 10.9l3.1-3.1" />
      <path d="M2.9 13h10.2" />
    </>
  ),
  external: (
    <>
      <path d="M6.4 3.6H4.1a1.6 1.6 0 0 0-1.6 1.6v6.7a1.6 1.6 0 0 0 1.6 1.6h6.7a1.6 1.6 0 0 0 1.6-1.6V9.5" />
      <path d="M9.6 2.5h4v4" />
      <path d="M13.5 2.5 8.2 7.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.4 8a5.4 5.4 0 1 1-1.58-3.82" />
      <path d="M13.4 2.6v3.3h-3.3" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  // Two rings with teeth butted against the outer one — detached ticks read as
  // a sun at this size, not a cog.
  settings: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1.9" />
      <path d="M8 3.5V1.7M8 12.5v1.8M12.5 8h1.8M3.5 8H1.7M11.18 4.82l1.27-1.27M4.82 11.18 3.55 12.45M11.18 11.18l1.27 1.27M4.82 4.82 3.55 3.55" />
    </>
  ),
  back: (
    <>
      <path d="M12.8 8h-9" />
      <path d="M7.3 4.5 3.8 8l3.5 3.5" />
    </>
  ),
}

export function Icon({
  name,
  size = 14,
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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

/** A tinted square holding an icon — used where the mockup had a large emoji. */
export function IconBadge({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <span
      style={{
        width: size + 22,
        height: size + 22,
        borderRadius: 10,
        background: 'var(--accbg)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--acc)',
      }}
    >
      <Icon name={name} size={size} />
    </span>
  )
}
