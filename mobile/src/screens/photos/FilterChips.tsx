/**
 * The timeline's filter row — UI-MOBILE.md §2.1.
 *
 * The vocabulary comes from `FILTERS` in the shared library, which is the same
 * list the desktop draws, so "Videos" means the same set of photos on both.
 * `review` is in that list and is deliberately not offered here: it is the
 * decision pipeline's cull queue, and the desktop shows it only when the
 * pipeline is on. Mobile has no Settings toggle for that yet.
 */

import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'

import { FILTERS, type PhotoFilter } from '../../lib/photos'
import { useTheme } from '../../theme/ThemeProvider'

const OFFERED = FILTERS.filter((f) => f.id !== 'review')

export function FilterChips({
  value,
  onChange,
}: {
  value: PhotoFilter
  onChange: (next: PhotoFilter) => void
}) {
  const theme = useTheme()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: theme.spacing['spacing-04'], paddingVertical: 8 }}
    >
      {OFFERED.map((filter) => {
        const active = filter.id === value
        return (
          <Pressable
            key={filter.id}
            onPress={() => onChange(filter.id)}
            // The visible chip is 32pt, which is the right size for a row of
            // filters and the wrong size for a thumb. `hitSlop` gives it the
            // 44pt target the spec asks for without making the row look like a
            // toolbar.
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.color['background-selected'] : theme.color['layer-01'],
                borderColor: active ? theme.color['border-interactive'] : theme.color['border-subtle-01'],
                borderRadius: theme.radius.full,
                paddingHorizontal: theme.spacing['spacing-04'],
              },
            ]}
          >
            <Text
              style={[
                theme.text['text-body-compact-01'],
                { color: active ? theme.color['text-primary'] : theme.color['text-secondary'] },
              ]}
            >
              {filter.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  chip: { minHeight: 32, justifyContent: 'center', borderWidth: 1 },
})
