/**
 * BuildNexus iconography on React Native — Carbon's artwork, our names.
 *
 * The desktop's `Icon.tsx` is a name-based facade over `@carbon/icons-react`
 * and this is the same facade over generated geometry, because
 * `@carbon/icons-react` renders DOM `<svg>` and cannot run here. The vocabulary
 * is deliberately identical: `folder` means the same glyph on both clients, and
 * `scripts/gen-mobile-icons.mjs` is what keeps that true.
 *
 * Carbon draws at 16, 20, 24 and 32 and BuildNexus says not to scale to other
 * sizes, so `size` snaps to the nearest — the same snapping rule the desktop
 * uses, rather than a second opinion about it.
 */

import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg'

import { useTheme } from '../theme/ThemeProvider'
import { icons, VIEW_BOX, type IconName, type IconShape, type IconVariant } from './icons.generated'

export type { IconName }

const SIZES = [16, 20, 24, 32] as const
type IconSize = (typeof SIZES)[number]

function snap(size: number): IconSize {
  return SIZES.reduce(
    (best, candidate) => (Math.abs(candidate - size) < Math.abs(best - size) ? candidate : best),
    16 as IconSize,
  )
}

function shape(part: IconShape, key: number, fill: string) {
  // `fillRule` is passed through as an SVG attribute; react-native-svg wants it
  // as `fillRule`, which is what the generator already emits.
  switch (part.tag) {
    case 'path':
      return <Path key={key} d={part.d} fill={fill} fillRule={part.fillRule} />
    case 'circle':
      return <Circle key={key} cx={part.cx} cy={part.cy} r={part.r} fill={fill} />
    case 'rect':
      return <Rect key={key} x={part.x} y={part.y} width={part.width} height={part.height} fill={fill} />
    case 'polygon':
      return <Polygon key={key} points={part.points} fill={fill} />
  }
}

export function Icon({
  name,
  size = 16,
  variant = 'outline',
  color,
}: {
  name: IconName
  size?: number
  /** The solid Carbon variant, where one exists. Falls back to the outline. */
  variant?: 'outline' | 'filled'
  /** Defaults to `icon-primary`. Pass a token value, not a literal. */
  color?: string
}) {
  const theme = useTheme()

  // Annotated rather than inferred. `icons` is `as const`, so TypeScript knows
  // exactly which entries have a `filled` variant and objects to reading one
  // that does not. Widening to `IconVariant` is what makes `filled` optional
  // for every icon, which is how the artwork actually varies.
  const glyph: IconVariant = icons[name]
  const parts = (variant === 'filled' && glyph.filled) || glyph.outline
  const fill = color ?? theme.color['icon-primary']
  const px = snap(size)

  return (
    <Svg width={px} height={px} viewBox={VIEW_BOX} fill="none">
      {parts.map((part, i) => shape(part, i, fill))}
    </Svg>
  )
}
