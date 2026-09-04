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
  | { type: 'MUNIM_BRIDGE_READY' }

export type NativeToWebMessage =
  | { type: 'MUNIM_EXPLAIN_VERDICT_CHUNK'; requestId: string; token: string }
  | { type: 'MUNIM_EXPLAIN_VERDICT_DONE'; requestId: string; fullText: string }
  | { type: 'MUNIM_EXPLAIN_VERDICT_ERROR'; requestId: string; message: string }
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
  };

  send({ type: 'MUNIM_BRIDGE_READY' });
  true;
})();
true;
`
}
