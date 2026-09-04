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
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'

import { broadcastStatus, getInjectedJavaScriptBeforeLoad, handleBridgeMessage } from './modules/bridge'
import { explainVerdict, loadModel, onModelProgress, type ModelProgress } from './modules/localLlm'

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
      {__DEV__ ? <DevPanel onTestModel={() => runDevModelTest(forwardStatus)} status={modelStatus} /> : null}
    </SafeAreaView>
  )
}

/**
 * Dev-only affordance (stripped from release builds via __DEV__) to
 * exercise modules/localLlm.ts directly from the native shell, without
 * needing the PWA to send a bridge request. Useful for confirming the
 * model downloads/loads/streams correctly on a real device independent of
 * whatever the frontend has or hasn't wired up yet.
 */
function DevPanel({ onTestModel, status }: { onTestModel: () => void; status: ModelProgress }) {
  return (
    <View style={styles.devPanel} pointerEvents="box-none">
      <Text onPress={onTestModel} style={styles.devButton}>
        🧪 Test local model ({status.status}
        {status.fraction !== undefined ? ` ${Math.round(status.fraction * 100)}%` : ''})
      </Text>
    </View>
  )
}

async function runDevModelTest(forwardStatus: (p: ModelProgress) => void) {
  const unsubscribe = onModelProgress(forwardStatus)
  try {
    await loadModel()
    const sampleVerdict = {
      status: 'FIXABLE_BLOCKED',
      itc_amount: 0,
      itc_blocked: 4500,
      blocked_reason: 'Supplier GSTIN not found in GSTR-2B for this period',
      fix_action: 'Ask supplier to file GSTR-1 for this month',
      supplier_name: 'Sharma Traders',
      invoice_number: 'INV-2026-0417',
      total_amount: 26500,
    }
    let out = ''
    for await (const token of explainVerdict(sampleVerdict, 'hi')) {
      out += token
      // eslint-disable-next-line no-console
      console.log('[localLlm dev test] streaming:', out)
    }
    // eslint-disable-next-line no-console
    console.log('[localLlm dev test] final:', out)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[localLlm dev test] failed:', err)
  } finally {
    unsubscribe()
  }
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
