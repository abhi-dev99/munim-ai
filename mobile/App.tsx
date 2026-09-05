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
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native'
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

const PLATFORM: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android'

export default function App() {
  const webviewRef = useRef<WebView>(null)
  const [modelStatus, setModelStatus] = useState<ModelProgress>({ status: 'idle' })
  // Populated once loadModel() actually resolves — real backend info (e.g.
  // devices: ["HTP0"] for the Hexagon NPU), never fabricated.
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null)
  // Set while the web page has an in-flight MUNIM_CAPTURE_PHOTO_REQUEST —
  // shows the motion-gated camera screen full-screen over the WebView.
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null)

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
      <WebView
        ref={webviewRef}
        source={{ uri: TRADER_PWA_URL }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>Loading Munim…</Text>
          </View>
        )}
      />
      {captureRequestId ? (
        <View style={StyleSheet.absoluteFill}>
          <SteadyCameraCapture onCaptured={handleCaptured} onCancel={handleCaptureCancel} />
        </View>
      ) : null}
      {__DEV__ ? <ModelStatusPill status={modelStatus} backend={backendInfo} /> : null}
    </SafeAreaView>
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
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  loadingText: {
    marginTop: 12,
    color: '#444',
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
