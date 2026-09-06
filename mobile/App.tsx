/**
 * Munim Trader — native shell.
 *
 * Wraps the EXISTING Next.js trader PWA (frontend/src/app/trader/page.js,
 * untouched by this app) in a WebView, and exposes a native <-> web bridge
 * (modules/bridge.ts, contract documented in BRIDGE.md) that lets the web
 * page ask the on-device model (modules/localLlm.ts, llama.rn) to narrate
 * an already-computed GST verdict — an offline-capable alternative to the
 * backend's existing Gemini explanation call.
 *
 * This screen intentionally does very little of its own: it is a thin host
 * for the PWA, not a reimplementation of it.
 *
 * New Architecture note: llama.rn >= 0.10 requires React Native's New
 * Architecture (see modules/localLlm.ts's header). This app scaffolded on
 * Expo SDK 57 / React Native 0.86, where New Architecture is no longer
 * optional — `newArchEnabled` was removed from the app.json schema in SDK
 * 55 because Legacy Architecture support was dropped entirely, so there is
 * nothing to toggle here; `npx expo-doctor` confirms a clean config with no
 * such setting present. Verified via expo-doctor (21/21 checks passed), not
 * assumed.
 */

import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, BackHandler, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Notifications from 'expo-notifications'

import {
  broadcastStatus,
  getInjectedJavaScriptBeforeLoad,
  handleBridgeMessage,
  sendCapturePhotoError,
  sendCapturePhotoResult,
  setCaptureRequestHandler,
} from './modules/bridge'
import { getBackendInfo, loadModel, onModelProgress, type BackendInfo, type ModelProgress } from './modules/localLlm'
import SteadyCameraCapture from './components/SteadyCameraCapture'
import DeviceSensorsScreen from './components/DeviceSensorsScreen'
import ClientPicker from './components/ClientPicker'

// EXPO_PUBLIC_ vars are inlined at build time by Expo (no extra config
// needed — see https://docs.expo.dev/guides/environment-variables/).
//
// The placeholder below is deliberately a localhost URL: it only works from
// an emulator/simulator on the same machine as `npm run dev` in frontend/.
// During the actual hackathon, set EXPO_PUBLIC_TRADER_PWA_URL (in mobile/.env,
// or as a build-time env var passed to `eas build`) to whichever address the
// deployed/LAN-reachable frontend is actually running at — e.g. the ngrok
// tunnel domain from CLAUDE.md, a Vercel deploy, or the laptop's LAN IP
// (`http://192.168.x.x:3000/trader`) so a physical loaner phone on the same
// wifi can reach it. A physical device cannot reach `localhost` on the
// laptop, so leaving the default as-is will only ever work in an emulator.
const TRADER_PWA_URL = process.env.EXPO_PUBLIC_TRADER_PWA_URL || 'http://localhost:3000/trader'

// The WebView now loads the site's ROOT, not /trader or /dashboard directly.
// frontend/src/app/page.js already does 100% of the role detection and
// routing on its own -- verify-otp returns which role(s) a phone number
// actually has (backend/app/api/auth.py), and the login page's own
// client-side router.push() sends a trader to /trader, a CA to /dashboard,
// or shows a "log in as" choice for a genuine dual-role number. This native
// shell used to duplicate that decision with its own Trader/CA tab switcher
// -- redundant with a source of truth the web page already had, and the
// actual bug report that started this: the switcher bar rendered up under
// the status bar on some Android configurations and couldn't be tapped at
// all. Removing the switcher rather than just moving it down: the web page
// choosing the destination is strictly more correct than a native toggle
// that has no idea which role the logged-in number actually has.
const PWA_BASE_URL = TRADER_PWA_URL.replace(/\/trader\/?$/, '')

const PLATFORM: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  )
}

/**
 * useSafeAreaInsets() (react-native-safe-area-context) replaces a hand-rolled
 * `paddingTop: RNStatusBar.currentHeight` guess that a real device test
 * showed wasn't reliable -- react-native core's own SafeAreaView is
 * iOS-only in practice (a well-known, long-standing limitation; it's a
 * no-op on Android), and RNStatusBar.currentHeight can read back
 * `undefined` before the native module has settled on some Android
 * configurations, silently collapsing the padding to 0 -- which is exactly
 * what put the Trader/CA switcher tabs up under the status bar, unreadable
 * and unclickable. This hook asks Android/iOS for the real, measured inset
 * instead of guessing it.
 */
function AppContent() {
  const insets = useSafeAreaInsets()
  const webviewRef = useRef<WebView>(null)
  const [modelStatus, setModelStatus] = useState<ModelProgress>({ status: 'idle' })
  // Populated once loadModel() actually resolves — real backend info (e.g.
  // devices: ["HTP0"] for the Hexagon NPU), never fabricated.
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null)
  // Set while the web page has an in-flight MUNIM_CAPTURE_PHOTO_REQUEST —
  // shows the motion-gated camera screen full-screen over the WebView.
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null)
  // Trader's real language_pref, forwarded from trader/page.js's own
  // MUNIM_CAPTURE_PHOTO_REQUEST call -- controls only this capture screen's
  // fixed strings, not a general app-wide language switch.
  const [captureLang, setCaptureLang] = useState<string | undefined>(undefined)
  // Opens the honest sensor-diagnostics screen (see its own header comment
  // for why this is a showcase, not a feature). Native-triggered only -- the
  // web page has no way to open this and doesn't need one.
  const [sensorsScreenOpen, setSensorsScreenOpen] = useState(false)
  // Tracks the WebView's own current path -- the ONLY reason the native side
  // needs to know this at all is to (a) show ClientPicker only while on
  // /dashboard, and (b) trigger the biometric gate the moment the web page's
  // own router navigates there. Both are reactive to navigation now, not
  // preemptive the way switchView() used to intercept a tap before it
  // happened -- an unavoidable trade-off of the web page owning routing:
  // the native side only finds out after the page has already navigated.
  const [currentPath, setCurrentPath] = useState('/')
  // Guards against re-prompting on every onNavigationStateChange event that
  // fires while ALREADY on /dashboard (WebView fires this repeatedly during
  // a single page's load, not just on actual URL changes) -- only the
  // transition INTO /dashboard from somewhere else should trigger it.
  const wasOnDashboard = useRef(false)
  // Mirrors WebViewNavigation.canGoBack -- read by the hardware-back-button
  // handler below without needing it in React state (it changes on every
  // navigation event, far more often than a re-render is worth).
  const canGoBackRef = useRef(false)

  const onNavigationStateChange = useCallback(async (navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack
    let path = '/'
    try {
      path = new URL(navState.url).pathname
    } catch {
      // Malformed/about:blank during a transient load state -- keep '/'.
    }
    setCurrentPath(path)

    const nowOnDashboard = path.startsWith('/dashboard')
    if (nowOnDashboard && !wasOnDashboard.current) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync()
      const isEnrolled = await LocalAuthentication.isEnrolledAsync()
      if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock CA Dashboard',
          fallbackLabel: 'Use Passcode',
        })
        if (!result.success) {
          webviewRef.current?.goBack()
          wasOnDashboard.current = false
          return
        }
      }
    }
    wasOnDashboard.current = nowOnDashboard
  }, [])

  // Keep the web page's window.MunimNative.getStatus()/onStatusChange() in
  // sync with the native model lifecycle, so the PWA can show its own
  // "downloading local model… 42%" UI once it's wired up to use this.
  const forwardStatus = useCallback((progress: ModelProgress) => {
    setModelStatus(progress)
    broadcastStatus(webviewRef.current, {
      type: 'MUNIM_STATUS_EVENT',
      status: progress.status,
      progress:
        progress.downloadedBytes !== undefined && progress.totalBytes !== undefined
          ? {
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              fraction: progress.fraction ?? 0,
            }
          : undefined,
      message: progress.message,
    })
  }, [])

  const [traders, setTraders] = useState<{id: string, name?: string, business_name?: string, gstin?: string}[]>([])
  const [activeTraderId, setActiveTraderId] = useState<string | null>(null)

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data)
      if (msg.type === 'MUNIM_TRADER_LIST') {
        setTraders(msg.traders)
        if (!activeTraderId && msg.traders && msg.traders.length > 0) {
          setActiveTraderId(msg.traders[0].id)
        }
        return
      }
    } catch {}
    handleBridgeMessage(event.nativeEvent.data, webviewRef.current)
  }, [activeTraderId])

  const handleClientSelect = useCallback((traderId: string) => {
    setActiveTraderId(traderId)
    if (webviewRef.current) {
      webviewRef.current.injectJavaScript(`
        window.postMessage(JSON.stringify({ type: 'MUNIM_SET_CLIENT', traderId: '${traderId}' }), '*');
        true;
      `)
    }
  }, [])

  useEffect(() => {
    async function setupPush() {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus === 'granted') {
          try {
            const token = (await Notifications.getExpoPushTokenAsync()).data;
            if (webviewRef.current) {
              webviewRef.current.injectJavaScript(`
                window.postMessage(JSON.stringify({ type: 'MUNIM_PUSH_TOKEN', token: '${token}' }), '*');
                true;
              `);
            }
          } catch (e) {
            console.log('Failed to get push token', e);
          }
        }
      }
    }
    setupPush();
  }, []); // Register once per app session -- no view-switch concept to retrigger on any more

  useEffect(() => {
    setCaptureRequestHandler((requestId, lang) => {
      setCaptureRequestId(requestId)
      setCaptureLang(lang)
    })
    return () => setCaptureRequestHandler(null)
  }, [])

  const handleCaptured = useCallback((base64: string, mimeType: string) => {
    if (captureRequestId) sendCapturePhotoResult(webviewRef.current, captureRequestId, base64, mimeType)
    setCaptureRequestId(null)
  }, [captureRequestId])

  const handleCaptureCancel = useCallback(() => {
    if (captureRequestId) sendCapturePhotoError(webviewRef.current, captureRequestId, 'cancelled')
    setCaptureRequestId(null)
  }, [captureRequestId])

  // Prewarm: start the model download/load as soon as the app opens rather
  // than waiting for the trader's first scan to result in an explainVerdict
  // bridge request — same rationale as the frontend's prewarmHSNMatcher().
  useEffect(() => {
    const unsubscribe = onModelProgress(forwardStatus)
    loadModel()
      .then(() => setBackendInfo(getBackendInfo()))
      .catch(() => {
        // Surfaced via forwardStatus's 'error' status already; the web page
        // (and the real scan flow) fall back to the backend Gemini diagnosis
        // when window.MunimNative isn't ready, so nothing further to do here.
      })
    return unsubscribe
  }, [forwardStatus])

  // Android hardware/gesture back button. Without this, BackHandler's
  // default (no listener registered) exits the whole app on a single back
  // press regardless of where the trader is -- inside the camera screen,
  // three levels deep in the dashboard, anywhere. Priority order: close a
  // full-screen native overlay first if one's open, then let the WebView
  // navigate its own history back (it owns routing entirely now, see
  // onNavigationStateChange's own comment above), and only once there's
  // nowhere left to go does this become "press back again to exit."
  //
  // Trader and CA are treated as two separate apps that just happen to
  // share a shell, by explicit request -- back is allowed to move within
  // one side's own sub-pages (/dashboard/profile back to /dashboard), but
  // never lets a back-press cross from one side's root into the other
  // side's WebView history, even though the underlying WebView history
  // stack doesn't actually distinguish them. Landing on a side's own root
  // is treated the same as "nothing left to go back to" -- the very next
  // back press becomes the exit confirmation, not a jump into the other
  // side.
  const lastBackPressRef = useRef(0)
  useEffect(() => {
    if (Platform.OS !== 'android') return

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sensorsScreenOpen) {
        setSensorsScreenOpen(false)
        return true
      }
      if (captureRequestId) {
        handleCaptureCancel()
        return true
      }
      const atSideRoot = currentPath === '/trader' || currentPath === '/dashboard'
      if (canGoBackRef.current && !atSideRoot) {
        webviewRef.current?.goBack()
        return true
      }
      const now = Date.now()
      if (now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp()
        return true
      }
      lastBackPressRef.current = now
      ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT)
      return true
    })

    return () => subscription.remove()
  }, [sensorsScreenOpen, captureRequestId, handleCaptureCancel, currentPath])

  const injectedJavaScriptBeforeContentLoaded = getInjectedJavaScriptBeforeLoad(PLATFORM)

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      {/* Sensors diagnostics entry point -- own workstream, kept as a small
          floating pill now that there's no switcher row for it to sit
          below. Native-triggered only, the web page has no way to open it. */}
      <Pressable onPress={() => setSensorsScreenOpen(true)} style={styles.sensorsButton}>
        <Text style={styles.sensorsButtonText}>Sensors</Text>
      </Pressable>
      <WebView
        ref={webviewRef}
        source={{ uri: PWA_BASE_URL }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => <LoadingScreen />}
      />
      {currentPath.startsWith('/dashboard') && traders.length > 0 ? (
        <ClientPicker
          traders={traders}
          activeTraderId={activeTraderId}
          onSelect={handleClientSelect}
        />
      ) : null}
      {captureRequestId ? (
        <View style={StyleSheet.absoluteFill}>
          <SteadyCameraCapture onCaptured={handleCaptured} onCancel={handleCaptureCancel} lang={captureLang} />
        </View>
      ) : null}
      {sensorsScreenOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <DeviceSensorsScreen onClose={() => setSensorsScreenOpen(false)} />
        </View>
      ) : null}
      {__DEV__ ? <ModelStatusPill status={modelStatus} backend={backendInfo} /> : null}
    </View>
  )
}

// How long a load gets before the spinner escalates to a skeleton. Below
// this, a plain spinner reads as "basically instant" -- swapping it for a
// skeleton this early would just be visual noise for a load that was going
// to finish before a human could really look at it. Past it, the load is
// slow enough that a skeleton (something recognizable as "the dashboard is
// nearly here") reduces perceived wait better than a spinner that gives no
// sense of progress at all.
const SKELETON_DELAY_MS = 600

/**
 * WebView's renderLoading, escalating from a spinner to a layout-shaped
 * skeleton the longer a page load takes -- a fast/cached load (good network)
 * never gets past the spinner; a slow one (poor network, cold Cloud Run
 * instance) gets something that looks like progress instead of an
 * indefinite spin. The WebView no longer remounts on navigation (it owns its
 * own history now -- the native shell loads the root URL once and lets the
 * web app's router take it from there), so this only fires for the app's
 * single initial load, not on every trader/CA switch the way it used to.
 */
function LoadingScreen() {
  const [showSkeleton, setShowSkeleton] = useState(false)
  const pulse = useRef(new Animated.Value(0.35)).current

  useEffect(() => {
    const timer = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!showSkeleton) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [showSkeleton, pulse])

  if (!showSkeleton) {
    return (
      <View style={styles.loadingOverlay}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <View style={styles.skeletonScreen}>
      <Animated.View style={[styles.skeletonHeaderBar, { opacity: pulse }]} />
      <View style={styles.skeletonRow}>
        <Animated.View style={[styles.skeletonCard, { opacity: pulse }]} />
        <Animated.View style={[styles.skeletonCard, { opacity: pulse }]} />
      </View>
      <View style={styles.skeletonRow}>
        <Animated.View style={[styles.skeletonCard, { opacity: pulse }]} />
        <Animated.View style={[styles.skeletonCard, { opacity: pulse }]} />
      </View>
      <Animated.View style={[styles.skeletonBlock, { opacity: pulse }]} />
      <Animated.View style={[styles.skeletonBlockShort, { opacity: pulse }]} />
    </View>
  )
}

/**
 * Dev-only, real-data status indicator (stripped from release builds via
 * __DEV__): shows the actual local-model lifecycle (download progress, then
 * which backend it loaded on) as it happens from the prewarm above — never
 * a manually-triggered fake narration. Real scan narration now happens via
 * the bridge, driven by frontend/src/app/trader/page.js.
 */
function ModelStatusPill({ status, backend }: { status: ModelProgress; backend: BackendInfo | null }) {
  const backendLabel = backend
    ? backend.devices && backend.devices.length > 0
      ? backend.devices.join(', ')
      : backend.gpu
        ? 'GPU (unnamed device)'
        : 'CPU'
    : null

  return (
    <View style={styles.devPanel} pointerEvents="none">
      <Text style={styles.devButton}>
        Local model: {status.status}
        {status.fraction !== undefined ? ` ${Math.round(status.fraction * 100)}%` : ''}
        {backendLabel ? ` (${backendLabel})` : ''}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
    // paddingTop is applied inline from useSafeAreaInsets() above, not here --
    // see AppContent's own comment for why a static/computed guess isn't
    // reliable enough for this specific bug.
  },
  webview: {
    flex: 1,
  },
  // Sensors diagnostics entry point -- its own tiny floating pill in the
  // top-right corner of the safe-area content, no switcher row to clear any
  // more.
  sensorsButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  sensorsButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  skeletonScreen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ffffff',
    padding: 16,
    paddingTop: 24,
    gap: 12,
  },
  skeletonHeaderBar: {
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e5e5e5',
    marginBottom: 8,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  skeletonCard: {
    flex: 1,
    height: 90,
    borderRadius: 12,
    backgroundColor: '#e5e5e5',
  },
  skeletonBlock: {
    height: 140,
    borderRadius: 12,
    backgroundColor: '#e5e5e5',
    marginTop: 8,
  },
  skeletonBlockShort: {
    height: 70,
    borderRadius: 12,
    backgroundColor: '#e5e5e5',
  },
  devPanel: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  devButton: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    overflow: 'hidden',
    fontSize: 12,
  },
})
