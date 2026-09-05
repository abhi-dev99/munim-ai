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
import { ActivityIndicator, Animated, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'

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

// Both /trader (this trader's own view) and /dashboard (the CA's client
// list) live on the same Next.js origin, so localStorage-based auth
// (CLAUDE.md: JWT persists in localStorage across navigation) survives
// switching between them in the same WebView -- one login, either view.
// Derived rather than duplicated so EXPO_PUBLIC_TRADER_PWA_URL only has to
// be set in one place; falls back to appending /dashboard if the env var
// didn't end in /trader for some reason.
const PWA_BASE_URL = TRADER_PWA_URL.replace(/\/trader\/?$/, '')
const DASHBOARD_PWA_URL = `${PWA_BASE_URL}/dashboard`

const PLATFORM: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android'

type ViewMode = 'trader' | 'dashboard'

export default function App() {
  const webviewRef = useRef<WebView>(null)
  const [modelStatus, setModelStatus] = useState<ModelProgress>({ status: 'idle' })
  // Populated once loadModel() actually resolves — real backend info (e.g.
  // devices: ["HTP0"] for the Hexagon NPU), never fabricated.
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null)
  // Set while the web page has an in-flight MUNIM_CAPTURE_PHOTO_REQUEST —
  // shows the motion-gated camera screen full-screen over the WebView.
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null)
  // Opens the honest sensor-diagnostics screen (see its own header comment
  // for why this is a showcase, not a feature). Native-triggered only -- the
  // web page has no way to open this and doesn't need one.
  const [sensorsScreenOpen, setSensorsScreenOpen] = useState(false)
  // Which of the two web app views the WebView currently points at. A full
  // page load either way (not a client-side route change we can't trigger
  // from outside the page), but the auth token is in localStorage on the
  // shared origin so neither view needs a fresh login. Demo-day fix for a
  // real gap: this shell previously hardcoded /trader only, so there was no
  // way to show the CA's dashboard from the phone at all regardless of
  // which number logged in.
  const [viewMode, setViewMode] = useState<ViewMode>('trader')
  // The page can navigate itself out from under viewMode (authFetch's own
  // 401 handler sends any unauthenticated request to "/", and "/" redirects
  // post-login) -- so tapping a tab has to force a fresh WebView every time,
  // even a tap on the tab viewMode already says is active, or it can appear
  // to do nothing if the page had already drifted somewhere else.
  const [navNonce, setNavNonce] = useState(0)
  const switchView = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    setNavNonce((n) => n + 1)
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

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    handleBridgeMessage(event.nativeEvent.data, webviewRef.current)
  }, [])

  useEffect(() => {
    setCaptureRequestHandler((requestId) => setCaptureRequestId(requestId))
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

  const injectedJavaScriptBeforeContentLoaded = getInjectedJavaScriptBeforeLoad(PLATFORM)

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.viewSwitcher}>
        <Pressable
          onPress={() => switchView('trader')}
          style={[styles.viewSwitcherTab, viewMode === 'trader' && styles.viewSwitcherTabActive]}
        >
          <Text style={[styles.viewSwitcherText, viewMode === 'trader' && styles.viewSwitcherTextActive]}>
            Trader
          </Text>
        </Pressable>
        <Pressable
          onPress={() => switchView('dashboard')}
          style={[styles.viewSwitcherTab, viewMode === 'dashboard' && styles.viewSwitcherTabActive]}
        >
          <Text style={[styles.viewSwitcherText, viewMode === 'dashboard' && styles.viewSwitcherTextActive]}>
            CA Dashboard
          </Text>
        </Pressable>
      </View>
      {/* Sensors diagnostics entry point -- own workstream, deliberately kept
          out of the view-switcher row above so it can't conflict with other
          changes landing there in parallel. */}
      <Pressable onPress={() => setSensorsScreenOpen(true)} style={styles.sensorsButton}>
        <Text style={styles.sensorsButtonText}>Sensors</Text>
      </Pressable>
      <WebView
        key={`${viewMode}-${navNonce}`}
        ref={webviewRef}
        source={{ uri: viewMode === 'trader' ? TRADER_PWA_URL : DASHBOARD_PWA_URL }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => <LoadingScreen />}
      />
      {captureRequestId ? (
        <View style={StyleSheet.absoluteFill}>
          <SteadyCameraCapture onCaptured={handleCaptured} onCancel={handleCaptureCancel} />
        </View>
      ) : null}
      {sensorsScreenOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <DeviceSensorsScreen onClose={() => setSensorsScreenOpen(false)} />
        </View>
      ) : null}
      {__DEV__ ? <ModelStatusPill status={modelStatus} backend={backendInfo} /> : null}
    </SafeAreaView>
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
 * indefinite spin. Remounts fresh on every WebView key change (App.tsx's
 * viewMode/navNonce), so this always starts from "spinner" on a new load,
 * never carries stale skeleton state from a previous one.
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
  },
  webview: {
    flex: 1,
  },
  viewSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 4,
    gap: 4,
  },
  viewSwitcherTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewSwitcherTabActive: {
    backgroundColor: '#000',
  },
  viewSwitcherText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
  },
  viewSwitcherTextActive: {
    color: '#fff',
  },
  // Sensors diagnostics entry point -- its own tiny floating pill, positioned
  // just clear of the view-switcher row above rather than inside it.
  sensorsButton: {
    position: 'absolute',
    top: 52,
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
