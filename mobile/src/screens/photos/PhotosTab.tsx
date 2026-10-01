/**
 * The Photos tab's shell: a segmented control over Timeline and Albums, and the
 * album detail behind it.
 *
 * A segmented control rather than a fourth tab, which is UI-MOBILE.md's
 * reasoning verbatim — a fourth tab is "dead weight half the time". The tab bar
 * stays at three.
 *
 * Local state rather than a navigation route. Opening an album is a push that
 * needs the album object, and the photos in it are fetched anyway; giving it a
 * route would mean serialising an album through navigation params to save a
 * component. The one thing this costs is that Android's hardware back button
 * closes the app from an open album instead of returning to the list — worth
 * fixing, and noted here so it is not mistaken for working.
 */

import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Album } from '../../core/types'
import { useTheme } from '../../theme/ThemeProvider'
import { AlbumDetail } from './AlbumDetail'
import { AlbumsList } from './AlbumsList'
import { PhotosTimeline } from './PhotosTimeline'

/** Named `PhotosView`, not `View` — react-native already owns that name. */
type PhotosView = 'timeline' | 'albums'

export function PhotosTab() {
  const theme = useTheme()
  const [view, setView] = useState<PhotosView>('timeline')
  const [openAlbum, setOpenAlbum] = useState<Album | null>(null)

  if (openAlbum) {
    return <AlbumDetail album={openAlbum} onBack={() => setOpenAlbum(null)} />
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.color.background }]}>
      <View style={[styles.segments, { padding: theme.spacing['spacing-03'] }]}>
        {(['timeline', 'albums'] as const).map((option) => {
          const active = option === view
          return (
            <Pressable
              key={option}
              onPress={() => setView(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.segment,
                {
                  backgroundColor: active
                    ? theme.color['background-selected']
                    : theme.color['layer-01'],
                  borderRadius: theme.radius.small,
                },
              ]}
            >
              <Text
                style={[
                  theme.text['text-body-compact-01'],
                  { color: active ? theme.color['text-primary'] : theme.color['text-secondary'] },
                ]}
              >
                {option === 'timeline' ? 'Timeline' : 'Albums'}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {view === 'timeline' ? (
        <PhotosTimeline />
      ) : (
        <AlbumsList onOpen={(album) => setOpenAlbum(album)} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segments: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
})
