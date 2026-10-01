import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

/**
 * A placeholder, and deliberately a truthful one.
 *
 * The scaffold is real — the shared logic is copied, the polyfills are in place
 * and the desktop's own tests run against it — but no screen exists yet. The
 * screens are written twice, not ported (PLAN.md §11), so the desktop's cannot
 * be reused here.
 *
 * This is replaced by the navigation shell and the first real screen; until
 * then it says what is true rather than showing a gallery of invented photos.
 * A fabricated first screen is the kind of thing that survives into a build and
 * has to be hunted down later.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>FileSynapse</Text>
      <Text style={styles.note}>Screens not built yet.</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  note: {
    fontSize: 15,
    opacity: 0.6,
  },
})
