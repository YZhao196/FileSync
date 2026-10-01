/**
 * The result of an action, said once and then gone.
 *
 * UI-MOBILE.md wants a toast for every action result ("3 photos deleted",
 * "Download failed"), and the reason is worth keeping: these actions are
 * destructive or slow, and the alternative is a button that appears to do
 * nothing. It is also the only feedback channel the photo actions have — the
 * viewer has no room for inline messages.
 *
 * Rendered absolutely and high in the tree rather than through a native toast
 * library, so it cannot end up beneath a modal, and no dependency is added for
 * something this small. It fades with React Native's own `Animated`, which is
 * the one animation API available without pulling in reanimated.
 */

import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text } from 'react-native'

import { useTheme } from '../theme/ThemeProvider'

const VISIBLE_MS = 3200
const FADE_MS = 140

export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const theme = useTheme()
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!message) return

    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start()

    const timer = setTimeout(onDismiss, VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [message, onDismiss, opacity])

  if (!message) return null

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { opacity, bottom: theme.spacing['spacing-09'] }]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        style={[
          styles.toast,
          {
            backgroundColor: theme.color['background-inverse'],
            borderRadius: theme.radius.small,
            paddingHorizontal: theme.spacing['spacing-04'],
            paddingVertical: theme.spacing['spacing-03'],
          },
        ]}
      >
        <Text style={[theme.text['text-body-compact-01'], { color: theme.color['text-inverse'] }]}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { maxWidth: 560 },
})
