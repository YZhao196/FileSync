/**
 * The placeholder tile, matching the desktop's.
 *
 * The desktop draws `linear-gradient(145deg, a, b)` in CSS. React Native has no
 * gradients in its style system, so this is `expo-linear-gradient`, which takes
 * two points in the unit square rather than an angle — the angle is converted
 * once here instead of being approximated by eye at each call site.
 *
 * The conversion: CSS measures from "up", clockwise. Rotating the unit vector
 * that way gives `(sin θ, -cos θ)` in screen coordinates, where y grows
 * *downward* — which is why the sign flips. The line is then centred on the
 * tile, so each end sits half a vector out from the middle.
 *
 * These gradients are the mock backend's stand-in for photographs. When the
 * thumbnail cache lands, real bytes go where the gradient does and this becomes
 * the fallback for a photo whose thumbnail the server would not give up.
 */

import { LinearGradient } from 'expo-linear-gradient'
import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

import type { Gradient } from '../core/types'

const ANGLE_DEG = 145
const radians = (ANGLE_DEG * Math.PI) / 180
const halfX = Math.sin(radians) / 2
const halfY = -Math.cos(radians) / 2

const START = { x: 0.5 - halfX, y: 0.5 - halfY }
const END = { x: 0.5 + halfX, y: 0.5 + halfY }

export function GradientTile({
  gradient,
  style,
  testID,
  children,
}: {
  gradient: Gradient
  style?: StyleProp<ViewStyle>
  testID?: string
  children?: ReactNode
}) {
  return (
    <LinearGradient testID={testID} colors={gradient} start={START} end={END} style={style}>
      {children}
    </LinearGradient>
  )
}
