/**
 * Native <-> web bridge for the trader PWA WebView shell.
 *
 * Full protocol documentation (message shapes, both directions, a wiring
 * example for frontend/src/app/trader/page.js) lives in mobile/BRIDGE.md —
 * keep the two in sync if either changes. This file has two halves:
 *
 *  1. `INJECTED_JAVASCRIPT_BEFORE_LOAD` — a string of plain JS injected into
 *     the WebView via <WebView injectedJavaScriptBeforeContentLoaded=...>,
 *     which defines `window.MunimNative` inside the *web page's* JS realm.
 *     The existing Next.js trader app can feature-detect
 *     `window.MunimNative?.isAvailable` to offer on-device explanation as an
 *     alternative to its current backend/Gemini call — that wiring is a
 *     follow-up task and is NOT done here (frontend/ is untouched).
 *
 *  2. `handleBridgeMessage` — called from App.tsx's <WebView onMessage=...>
 *     on the native side. It parses one message the web page sent via
 *     `window.ReactNativeWebView.postMessage(...)`, and for an explain-verdict
 *     request, drives modules/localLlm.ts's explainVerdict() async generator,
 *     pushing each token back into the WebView with `injectJavaScript(...)`
 *     calls that invoke the web-side dispatcher the injected script defines.
 */

import type WebView from 'react-native-webview'
import { explainVerdict, type Lang, type Verdict } from './localLlm'

// --- Message types (kept in sync with mobile/BRIDGE.md) --------------------

export type WebToNativeMessage =
  | { type: 'MUNIM_EXPLAIN_VERDICT_REQUEST'; requestId: string; verdict: Verdict; lang: Lang }
  | { type: 'MUNIM_CANCEL_REQUEST'; requestId: string }
  | { type: 'MUNIM_CAPTURE_PHOTO_REQUEST'; requestId: string }
  | { type: 'MUNIM_BIOMETRIC_REQUEST'; requestId: string }
  | { type: 'MUNIM_BRIDGE_READY' }

export type NativeToWebMessage =
  | { type: 'MUNIM_EXPLAIN_VERDICT_CHUNK'; requestId: string; token: string }
  | { type: 'MUNIM_EXPLAIN_VERDICT_DONE'; requestId: string; fullText: string }
  | { type: 'MUNIM_EXPLAIN_VERDICT_ERROR'; requestId: string; message: string }
  | { type: 'MUNIM_CAPTURE_PHOTO_RESULT'; requestId: string; base64: string; mimeType: string }
  | { type: 'MUNIM_CAPTURE_PHOTO_ERROR'; requestId: string; message: string }
  | { type: 'MUNIM_BIOMETRIC_RESULT'; requestId: string; success: boolean; reason?: string }
  | {
      type: 'MUNIM_STATUS_EVENT'
      status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
      progress?: { downloadedBytes: number; totalBytes: number; fraction: number }
      message?: string
    }

// Tracks in-flight explainVerdict() generations so MUNIM_CANCEL_REQUEST can
// stop the right one (llama.rn only runs one completion at a time, but the
// requestId lets a future multi-slot setup extend this without changing the
// wire protocol).
const activeRequests = new Set<string>()

function sendToWeb(webview: WebView, message: NativeToWebMessage) {
  const json = JSON.stringify(message)
  // JSON.stringify(json) turns the JSON text into a safely-escaped JS string
  // literal (quotes/newlines/unicode all handled), so it can be embedded
  // directly into the injected script without manual escaping.
  const jsLiteral = JSON.stringify(json)
  webview.injectJavaScript(`window.__munimNativeDispatch && window.__munimNativeDispatch(${jsLiteral}); true;`)
}

type StatusEvent = Extract<NativeToWebMessage, { type: 'MUNIM_STATUS_EVENT' }>

/** Call from onModelProgress() so the web page can show download/load state. */
export function broadcastStatus(webview: WebView | null, event: StatusEvent): void {
  if (!webview) return
  sendToWeb(webview, event)
}

// A capture request needs to show a full-screen native camera view, which
// this module (plain functions, no React) can't render itself -- App.tsx
// registers a handler here once on mount that shows/hides that screen, and
// calls sendCapturePhotoResult/sendCapturePhotoError below once the screen
// resolves.
type CaptureRequestHandler = (requestId: string) => void
let captureRequestHandler: CaptureRequestHandler | null = null

export function setCaptureRequestHandler(handler: CaptureRequestHandler | null): void {
  captureRequestHandler = handler
}

export function sendCapturePhotoResult(webview: WebView | null, requestId: string, base64: string, mimeType: string): void {
  if (!webview) return
  sendToWeb(webview, { type: 'MUNIM_CAPTURE_PHOTO_RESULT', requestId, base64, mimeType })
}

export function sendCapturePhotoError(webview: WebView | null, requestId: string, message: string): void {
  if (!webview) return
  sendToWeb(webview, { type: 'MUNIM_CAPTURE_PHOTO_ERROR', requestId, message })
}

export async function handleBridgeMessage(rawData: string, webview: WebView | null): Promise<void> {
  if (!webview) return

  let message: WebToNativeMessage
  try {
    message = JSON.parse(rawData)
  } catch {
    return // not JSON, or not ours — ignore rather than throw
  }

  if (message.type === 'MUNIM_CANCEL_REQUEST') {
    activeRequests.delete(message.requestId)
    // localLlm only supports cancelling whatever completion is currently
    // running; safe to call even if it's a different requestId's job.
    const { stopExplaining } = await import('./localLlm')
    await stopExplaining()
    return
  }

  if (message.type === 'MUNIM_BRIDGE_READY') {
    return
  }

  if (message.type === 'MUNIM_CAPTURE_PHOTO_REQUEST') {
    if (captureRequestHandler) {
      captureRequestHandler(message.requestId)
    } else {
      sendCapturePhotoError(webview, message.requestId, 'Camera capture is not available right now.')
    }
    return
  }

  if (message.type === 'MUNIM_BIOMETRIC_REQUEST') {
    // Unlike capturePhoto, this needs no full-screen native view to render
    // (the OS itself draws the Face ID/fingerprint prompt), so it's handled
    // entirely here rather than round-tripping through a handler App.tsx
    // registers -- one less thing for a parallel workstream touching
    // App.tsx to conflict with.
    const { requestId } = message
    try {
      const { authenticateBiometric } = await import('./biometrics')
      const outcome = await authenticateBiometric('Confirm to dismiss this fraud alert')
      sendToWeb(webview, {
        type: 'MUNIM_BIOMETRIC_RESULT',
        requestId,
        success: outcome.success,
        reason: outcome.reason,
      })
    } catch (err) {
      // authenticateBiometric() already catches its own failures and
      // resolves rather than throws -- this is only a backstop so the web
      // side always gets a MUNIM_BIOMETRIC_RESULT and never waits forever.
      sendToWeb(webview, {
        type: 'MUNIM_BIOMETRIC_RESULT',
        requestId,
        success: false,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  if (message.type === 'MUNIM_EXPLAIN_VERDICT_REQUEST') {
    const { requestId, verdict, lang } = message
    activeRequests.add(requestId)
    try {
      let fullText = ''
      const generator = explainVerdict(verdict, lang)
      while (true) {
        const next = await generator.next()
        if (!activeRequests.has(requestId)) {
          // cancelled mid-stream
          break
        }
        if (next.done) {
          fullText = next.value ?? fullText
          break
        }
        fullText += next.value
        sendToWeb(webview, { type: 'MUNIM_EXPLAIN_VERDICT_CHUNK', requestId, token: next.value })
      }
      if (activeRequests.has(requestId)) {
        sendToWeb(webview, { type: 'MUNIM_EXPLAIN_VERDICT_DONE', requestId, fullText })
      }
    } catch (err) {
      sendToWeb(webview, {
        type: 'MUNIM_EXPLAIN_VERDICT_ERROR',
        requestId,
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      activeRequests.delete(requestId)
    }
  }
}

// --- Injected JS (runs inside the WebView's page JS realm) -----------------

export function getInjectedJavaScriptBeforeLoad(platform: 'ios' | 'android'): string {
  return `
(function () {
  if (window.MunimNative) { return true; }

  var pending = {};
  var reqCounter = 0;

  function genId() {
    reqCounter += 1;
    return 'req_' + Date.now() + '_' + reqCounter;
  }

  function send(msg) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  window.__munimNativeDispatch = function (jsonText) {
    var msg;
    try { msg = JSON.parse(jsonText); } catch (e) { return; }

    if (msg.type === 'MUNIM_STATUS_EVENT') {
      window.MunimNative._lastStatus = msg;
      window.MunimNative._statusListeners.forEach(function (fn) {
        try { fn(msg); } catch (e) {}
      });
      return;
    }

    var handlers = pending[msg.requestId];
    if (!handlers) { return; }

    if (msg.type === 'MUNIM_EXPLAIN_VERDICT_CHUNK') {
      handlers.onToken && handlers.onToken(msg.token);
    } else if (msg.type === 'MUNIM_EXPLAIN_VERDICT_DONE') {
      handlers.onDone && handlers.onDone(msg.fullText);
      delete pending[msg.requestId];
    } else if (msg.type === 'MUNIM_EXPLAIN_VERDICT_ERROR') {
      handlers.onError && handlers.onError(msg.message);
      delete pending[msg.requestId];
    } else if (msg.type === 'MUNIM_CAPTURE_PHOTO_RESULT') {
      handlers.onCaptured && handlers.onCaptured(msg.base64, msg.mimeType);
      delete pending[msg.requestId];
    } else if (msg.type === 'MUNIM_CAPTURE_PHOTO_ERROR') {
      handlers.onError && handlers.onError(msg.message);
      delete pending[msg.requestId];
    } else if (msg.type === 'MUNIM_BIOMETRIC_RESULT') {
      handlers.onResult && handlers.onResult(msg.success, msg.reason);
      delete pending[msg.requestId];
    }
  };

  window.MunimNative = {
    isAvailable: true,
    platform: '${platform}',
    _lastStatus: { status: 'idle' },
    _statusListeners: [],

    onStatusChange: function (fn) {
      window.MunimNative._statusListeners.push(fn);
      return function unsubscribe() {
        var i = window.MunimNative._statusListeners.indexOf(fn);
        if (i >= 0) { window.MunimNative._statusListeners.splice(i, 1); }
      };
    },

    getStatus: function () {
      return Promise.resolve(window.MunimNative._lastStatus);
    },

    // callbacks: { onToken(token), onDone(fullText), onError(message) }
    // returns a requestId usable with cancel()
    explainVerdict: function (verdict, lang, callbacks) {
      var requestId = genId();
      pending[requestId] = callbacks || {};
      send({
        type: 'MUNIM_EXPLAIN_VERDICT_REQUEST',
        requestId: requestId,
        verdict: verdict,
        lang: lang || 'hi',
      });
      return requestId;
    },

    cancel: function (requestId) {
      send({ type: 'MUNIM_CANCEL_REQUEST', requestId: requestId });
      delete pending[requestId];
    },

    // Shows the native motion-gated camera screen. callbacks:
    // { onCaptured(base64, mimeType), onError(message) }. The screen also
    // has its own cancel (X) button, which arrives here as onError with a
    // "cancelled" message rather than a separate callback -- one failure
    // path for the web side to handle instead of two.
    capturePhoto: function (callbacks) {
      var requestId = genId();
      pending[requestId] = callbacks || {};
      send({ type: 'MUNIM_CAPTURE_PHOTO_REQUEST', requestId: requestId });
      return requestId;
    },

    // Asks the OS for a Face ID / Touch ID / fingerprint prompt to confirm
    // a sensitive action -- today, just dismissing a FRAUD_FLAGGED scan
    // alert. callbacks: { onResult(success, reason), onError(message) }.
    // onResult fires exactly once with the real outcome, including a
    // declined/cancelled prompt (reason is one of expo-local-authentication's
    // error codes, e.g. "user_cancel", "lockout" -- or "not_available" when
    // this device can't do biometric auth at all: no sensor, or one with
    // nothing enrolled). onError mirrors capturePhoto's shape for a caller
    // that wants to register both, but native today always resolves via
    // onResult rather than taking this path.
    confirmBiometric: function (callbacks) {
      var requestId = genId();
      pending[requestId] = callbacks || {};
      send({ type: 'MUNIM_BIOMETRIC_REQUEST', requestId: requestId });
      return requestId;
    },
  };

  send({ type: 'MUNIM_BRIDGE_READY' });
  true;
})();
true;
`
}
