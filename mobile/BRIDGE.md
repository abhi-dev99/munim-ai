# Native ↔ web bridge

How `frontend/src/app/trader/page.js` (untouched by this app) can, in a
follow-up task, detect that it's running inside the `mobile/` native shell
and use the on-device model for the "narrate this verdict" step instead of
calling the backend's Gemini explanation endpoint.

Implementation lives in `mobile/modules/bridge.ts` (native side) — the
injected script that creates `window.MunimNative` inside the WebView's page
JS realm, plus `handleBridgeMessage`, which the native `<WebView
onMessage=...>` handler in `mobile/App.tsx` calls for every message the page
sends. The on-device model itself is `mobile/modules/localLlm.ts`
(`llama.rn`, see that file's header comment for model choice and scope).

## What this replaces, and what it doesn't

The backend's existing flow (`backend/app/agents/invoice_agent.py` →
`backend/app/services/gemini.py::generate_hindi_diagnosis`) does two things
after a verdict already exists: pick a language, and ask Gemini to narrate
that verdict into a 5-6 line WhatsApp-style message. `window.MunimNative`
offers an on-device alternative for **that narration step only**. It never
computes the verdict itself — `itc_verdict`, `fraud_result`, etc. still come
from `backend/app/domain/*`, 100% server-side and deterministic, exactly as
today. A future frontend change would be: after receiving a verdict from the
backend (with or without a Gemini `diagnosis_hi`/`diagnosis_en` already
attached), optionally call `window.MunimNative.explainVerdict(...)` instead
of trusting the backend's text, e.g. for an explicit "explain offline"
button, or as a fallback when the network request for the diagnosis fails.

## Feature detection

```js
const hasNativeLLM = typeof window !== 'undefined' && window.MunimNative?.isAvailable === true;
```

`window.MunimNative` only exists inside this native shell's WebView. Plain
browser access to the deployed PWA (or any other WebView that hasn't run
`getInjectedJavaScriptBeforeLoad()`) will not have it — always feature-detect,
never assume.

## `window.MunimNative` API (as seen from the web page)

```ts
type Verdict = {
  status: string;            // e.g. "CONFIRMED" | "FIXABLE_BLOCKED" | "AT_RISK" | "INELIGIBLE" | "FRAUD_FLAGGED" | "MISSED"
  itc_amount: number;
  itc_blocked?: number;
  blocked_reason?: string;
  reason?: string;
  fix_action?: string;
  supplier_name?: string;
  invoice_number?: string;
  total_amount?: number;
  fraud_score?: number;
  [key: string]: any;
};

type ExplainCallbacks = {
  onToken?: (token: string) => void;   // called once per streamed token
  onDone?: (fullText: string) => void; // called once, with the full assembled text
  onError?: (message: string) => void; // called once, instead of onDone, on failure
};

window.MunimNative: {
  isAvailable: true;
  platform: 'ios' | 'android';

  // Starts an on-device narration. Returns a requestId you can pass to
  // cancel(). Triggers a model download on first-ever call (see status
  // events below) — that can take a while on event wifi; show progress.
  explainVerdict(verdict: Verdict, lang: 'hi' | 'en', callbacks: ExplainCallbacks): string;

  // Stops an in-flight generation. Best-effort — the native side currently
  // has one llama.rn context, so this stops whatever is currently running.
  cancel(requestId: string): void;

  // Last known model status, resolved synchronously from a locally cached
  // value (no round trip to native).
  getStatus(): Promise<StatusEvent>;

  // Subscribe to model status changes (download progress, ready, error).
  // Returns an unsubscribe function.
  onStatusChange(fn: (event: StatusEvent) => void): () => void;
};

type StatusEvent = {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
  progress?: { downloadedBytes: number; totalBytes: number; fraction: number };
  message?: string;
};
```

### Example usage (illustrative — not wired into `frontend/` yet)

```js
if (window.MunimNative?.isAvailable) {
  const unsubscribe = window.MunimNative.onStatusChange((s) => {
    if (s.status === 'downloading') {
      setDownloadProgress(Math.round((s.progress?.fraction ?? 0) * 100));
    }
  });

  let text = '';
  window.MunimNative.explainVerdict(verdict, 'hi', {
    onToken: (tok) => { text += tok; setStreamingDiagnosis(text); },
    onDone: (full) => { setDiagnosis(full); unsubscribe(); },
    onError: (msg) => { console.error('local explain failed', msg); unsubscribe(); fallBackToServerDiagnosis(); },
  });
}
```

## Wire protocol (what actually crosses the WebView boundary)

Two one-way channels, both carrying `JSON.stringify`-d objects with a
`type` discriminant:

### Web → Native

Sent via `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`,
received by `<WebView onMessage>` in `mobile/App.tsx`, routed by
`handleBridgeMessage` in `mobile/modules/bridge.ts`.

| `type` | fields | meaning |
|---|---|---|
| `MUNIM_EXPLAIN_VERDICT_REQUEST` | `requestId: string`, `verdict: Verdict`, `lang: 'hi' \| 'en'` | Start narrating this verdict on-device. |
| `MUNIM_CANCEL_REQUEST` | `requestId: string` | Stop the in-flight generation. |
| `MUNIM_BRIDGE_READY` | — | Sent once, automatically, when the injected script finishes setting up `window.MunimNative`. Informational only — native doesn't need to act on it, but it's useful to log. |

### Native → Web

Sent via `webview.injectJavaScript(...)` calling
`window.__munimNativeDispatch(jsonText)`, which the injected script defines
and uses to route to the right pending request's callbacks (or to status
listeners).

| `type` | fields | meaning |
|---|---|---|
| `MUNIM_EXPLAIN_VERDICT_CHUNK` | `requestId`, `token: string` | One streamed token. Fires `onToken`. |
| `MUNIM_EXPLAIN_VERDICT_DONE` | `requestId`, `fullText: string` | Generation finished. Fires `onDone`, then the request is cleaned up. |
| `MUNIM_EXPLAIN_VERDICT_ERROR` | `requestId`, `message: string` | Generation failed (model load failure, download failure, llama.rn error). Fires `onError`, then cleaned up. |
| `MUNIM_STATUS_EVENT` | `status`, `progress?`, `message?` | Model lifecycle: `idle → downloading → loading → ready`, or `error` at any point. Fires every subscribed `onStatusChange` listener and updates the value `getStatus()` resolves. |

`__munimNativeDispatch` is not meant to be called directly by page code —
it's plumbing between `mobile/modules/bridge.ts` and the `window.MunimNative`
wrapper the injected script defines. Page code should only ever touch
`window.MunimNative`.

## Streaming format

Each `MUNIM_EXPLAIN_VERDICT_CHUNK.token` is exactly one llama.rn token
(a `TokenData.token` string as produced by `LlamaContext.completion()`'s
partial-completion callback) — not a word, not a line. Concatenating every
chunk's `token` in arrival order, in order, reproduces
`MUNIM_EXPLAIN_VERDICT_DONE.fullText` exactly; the web side does not need to
add separators or whitespace between chunks.

## Error handling notes for the frontend integration

- `MUNIM_EXPLAIN_VERDICT_ERROR` can fire for a mundane reason (first call on
  this device, download failed because the phone lost wifi mid-download) —
  treat it as "fall back to the existing backend Gemini diagnosis call",
  not as a fatal condition.
- There is currently one shared llama.rn context/completion slot. A second
  `explainVerdict()` call while one is already running will queue behind
  llama.rn's own internal handling rather than running in parallel — for a
  single-trader single-screen UI this should never actually happen, but
  don't assume multiple concurrent `requestId`s complete out of order or in
  parallel today.
- The first `explainVerdict()` call on a given device triggers a ~770 MB
  model download (see `mobile/modules/localLlm.ts` header comment for the
  exact model and why). Always subscribe to `onStatusChange` before calling
  `explainVerdict` for the first time in a session so a first-run download
  doesn't look like a hang.

## Status of this bridge

Built and present in `mobile/` (native side only, as scoped). **Not yet
wired into `frontend/src/app/trader/page.js`** — that integration (feature
detection, a UI affordance to trigger on-device explanation, a fallback path
to the existing backend call) is an explicit follow-up task, out of scope
for this pass, and `frontend/` was not modified while building this.
