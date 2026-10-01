/**
 * The navigation shell — UI-MOBILE.md's "Navigation".
 *
 * Three tabs, fixed: Photos, Files, Settings. Search is contextual and lives in
 * each tab's header rather than being a fourth tab that is dead half the time,
 * which is the spec's reasoning and a good one.
 *
 * **`@react-navigation`, not `expo-router`.** The project's convention is
 * `go(screen, target)` over an explicit union of screens — `CLAUDE.md` says so
 * and the desktop's `state/store.tsx` does it — and `expo-router` inverts that
 * into file-based routes where a screen *is* a path. Typed param lists express
 * the same idea without fighting it, and at three static tabs file-based
 * routing buys nothing. Deep links do not need it either; they come from the
 * `linking` config below.
 *
 * First Run is not a tab and not a modal — it replaces the whole shell when
 * there is no address. That is what makes "not skippable" structural: there is
 * no reachable state with a tab bar and no server.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { ActivityIndicator, View } from 'react-native'

import { Icon, type IconName } from '../components/Icon'
import { FilesScreen } from '../screens/files/FilesScreen'
import { FirstRunScreen } from '../screens/first-run/FirstRunScreen'
import { PhotosTab } from '../screens/photos/PhotosTab'
import { SettingsScreen } from '../screens/settings/SettingsScreen'
import { useSession } from '../state/session'
import { useTheme } from '../theme/ThemeProvider'

/** The param lists the screens take. Empty for now; the viewer and album
 *  screens will carry ids here rather than reaching into a global. */
export type TabParamList = {
  Photos: undefined
  Files: undefined
  Settings: undefined
}

const TABS: Array<{ name: keyof TabParamList; title: string; icon: IconName }> = [
  { name: 'Photos', title: 'Photos', icon: 'grid' },
  { name: 'Files', title: 'Files', icon: 'folder' },
  { name: 'Settings', title: 'Settings', icon: 'settings' },
]

/**
 * The URL scheme declared in app.json. Nothing in v1 emits one of these — the
 * app does no background work, so it never raises the notification the spec's
 * deep-link case describes. The handler is wired now so that when something
 * does, it lands on a route that exists rather than on nothing.
 */
const linking: LinkingOptions<TabParamList> = {
  prefixes: ['filesynapse://'],
  config: {
    screens: {
      Photos: 'photos',
      Files: 'files',
      Settings: 'settings',
    },
  },
}

const Tab = createBottomTabNavigator<TabParamList>()
const Stack = createNativeStackNavigator()

export function RootNavigator() {
  const theme = useTheme()
  const { ready, configured } = useSession()

  // Held until the stored address has been read. Rendering the tabs first and
  // then swapping to First Run would flash a gallery at someone who has not
  // connected yet.
  if (!ready) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.background }}
      >
        <ActivityIndicator color={theme.color['icon-primary']} />
      </View>
    )
  }

  if (!configured) return <FirstRunScreen />

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

function Tabs() {
  const theme = useTheme()

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color['icon-primary'],
        tabBarInactiveTintColor: theme.color['icon-secondary'],
        tabBarStyle: {
          backgroundColor: theme.color['layer-01'],
          borderTopColor: theme.color['border-subtle-00'],
        },
        // 44pt targets, per the spec's accessibility line.
        tabBarItemStyle: { minHeight: 44 },
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tab.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color }) => <Icon name={icon} size={20} color={color} />,
            tabBarAccessibilityLabel: title,
          }}
          // Photos and Files are already the right components; Settings is
          // named rather than inlined so the tab list above stays data.
          component={
            name === 'Photos' ? PhotosTab : name === 'Files' ? FilesScreen : SettingsScreen
          }
        />
      ))}
    </Tab.Navigator>
  )
}
