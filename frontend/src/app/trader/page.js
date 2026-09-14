"use client";
import { authFetch } from "@/src/app/utils/api";
import { assessPhotoQuality, GLARE_RATIO_THRESHOLD } from "@/src/app/utils/imageQuality";
import { vibrateAlert, vibrateSuccess, vibrateWarning } from "@/src/app/utils/haptics";
import { queueUpload, getQueuedUploads, removeQueuedUpload } from "@/src/app/utils/offlineQueue";
import { matchHSN, prewarmHSNMatcher } from "@/src/app/utils/hsnMatch";


import { useState, useEffect, useRef } from "react";
import { Menu, Camera, FileText, CheckCircle2, ShieldAlert, CloudOff, X, Loader2, Home, BarChart2, ChevronRight, LogOut, Sparkles } from "lucide-react";
import MoneyMeter from "../components/MoneyMeter";
import ActionQueue from "../components/ActionQueue";
import InvoiceDetailModal from "../components/InvoiceDetailModal";
import ReportsPanel from "../components/ReportsPanel";
import ListenButton from "../components/ListenButton";
import VoiceQueryButton from "../components/VoiceQueryButton";
import { useLanguage } from "../context/LanguageContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Language codes the trader's `language_pref` column can hold, paired with
// the name each language calls itself. Endonyms are deliberately NOT run
// through t(): a language picker has to be readable by someone who cannot
// read the language the app is currently in — that is the whole point of
// tapping it — so every option names itself in its own script, in every
// locale. (Hindi labels itself in Devanagari even though this app's Hindi
// copy is romanised Hinglish: हिंदी is the word a trader recognises.)
const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "mr", label: "मराठी" },
  { code: "gu", label: "ગુજરાતી" },
];

// BCP-47 tags for the Web Speech API's voice picker (utils/speech.js ->
// pickVoice). This replaces the old `diagnosis_hi ? "hi-IN" : "en-IN"`
// guess, which silently read Marathi and Gujarati traders their verdict in
// a Hindi voice purely because a localized diagnosis string existed at all.
const SPEECH_TAGS = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN" };

function toSpeechTag(code) {
  return SPEECH_TAGS[code] || SPEECH_TAGS.en;
}

// ITC verdict codes (backend/app/models/invoice.py::ITCStatus) plus the two
// UI-only placeholders, mapped to their translated labels. An unrecognised
// code falls through to the raw string rather than rendering blank — the
// domain engine is the source of truth for what a verdict is called, and a
// new one appearing here should look odd, not disappear.
const STATUS_LABEL_KEYS = {
  CONFIRMED: "tr_status_confirmed",
  FIXABLE_BLOCKED: "tr_status_fixable_blocked",
  AT_RISK: "tr_status_at_risk",
  MISSED: "tr_status_missed",
  INELIGIBLE: "tr_status_ineligible",
  FRAUD_FLAGGED: "tr_status_fraud_flagged",
  DUPLICATE: "tr_status_duplicate",
  PROCESSING: "tr_status_processing",
  PENDING: "tr_status_pending",
};

// Longest-edge size (px) a captured photo is downscaled to before the
// on-device quality analysis runs. Keeps the Laplacian-variance pass fast
// even for a multi-megapixel phone camera capture — only the analysis frame
// is downscaled, the original full-resolution file is still what gets
// uploaded when the photo passes (or the user overrides a warning).
const QUALITY_ANALYSIS_MAX_DIMENSION = 800;

// Backstop for a connection that *reports* itself online (navigator.onLine
// is true) but is actually dead — a dropped Wi-Fi/mobile-data session that
// hasn't been detected by the OS yet, common on the patchy connections this
// product targets. Long enough not to abort a real, slow-but-working Gemini
// OCR round trip; short enough that a truly stuck request still falls back
// to the offline queue instead of leaving the trader staring at a spinner.
// 75s (not 45s, not the original 30s) after checking real Cloud Run request
// logs for this exact endpoint and finding genuine 200 OK responses taking
// up to 44s server-side alone — 45s left almost no margin once real network
// transit time is added on top, so the client's abort was firing moments
// before an otherwise-successful response made it back.
const UPLOAD_TIMEOUT_MS = 75000;

// There's no on-device OCR in this app (see OCV-3 in
// IQOO_DEVICE_CAPABILITY_SPEC.md — deliberately not built), so there's no
// line-item text available client-side before the backend extracts it. The
// on-device HSN match therefore runs *after* the upload response comes
// back, against the real `supplier_name`/`line_item_descriptions` Gemini
// extracted — not before, and not against the file name. It's a display
// enrichment on an already-successful scan, never something the upload
// flow waits on.
function hsnMatchQueryFrom(data) {
  const items = (data.line_item_descriptions || []).join(", ");
  if (items) return items;
  return data.supplier_name || "";
}

/**
 * On-device blur/glare check: draws the captured file to an off-screen
 * canvas, extracts ImageData, and runs the pure imageQuality assessment —
 * entirely client-side, before any network request. Resolves to null for
 * non-image files (e.g. PDF) or if analysis fails for any reason, so the
 * upload flow always has a safe fallback and is never blocked by this check.
 */
function analyzeImageFile(file) {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !file?.type?.startsWith("image/")) {
      resolve(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    img.onload = () => {
      try {
        const scale = Math.min(1, QUALITY_ANALYSIS_MAX_DIMENSION / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        resolve(assessPhotoQuality(imageData));
      } catch (err) {
        console.warn("On-device photo quality check failed, skipping check.", err);
        resolve(null);
      } finally {
        cleanup();
      }
    };
    img.onerror = () => {
      cleanup();
      resolve(null);
    };
    img.src = objectUrl;
  });
}

export default function TraderApp() {
  const { t, lang: uiLang, changeLanguage, setProfileLanguage } = useLanguage();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [traderId, setTraderId] = useState(null);
  const [traderName, setTraderName] = useState("");
  const [traderPhone, setTraderPhone] = useState(null);
  const [traderLang, setTraderLang] = useState("hi");
  const [scanState, setScanState] = useState("idle");
  const [scanResult, setScanResult] = useState(null);
  const [activeTab, setActiveTab] = useState("home"); // home | history | reports
  const [invoiceHistory, setInvoiceHistory] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const [retakePrompt, setRetakePrompt] = useState(null); // { file, verdict } | null
  const [queuedCount, setQueuedCount] = useState(0);
  const fileInputRef = useRef(null);
  const draining = useRef(false);
  // Mirror of `traderLang` for the same reason applyUploadSuccess takes its
  // trader id explicitly: the `online` listener below registers once on
  // mount, so anything it calls closes over the mount-time `traderLang`
  // ("hi") forever and would narrate a drained Gujarati trader's invoice in
  // Hindi. A ref is always current.
  const traderLangRef = useRef("hi");

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const tradersRes = await authFetch(`${API_BASE}/api/v1/dashboard/traders`);
        if (!tradersRes.ok) throw new Error("Failed to fetch traders");
        const tradersData = await tradersRes.json();
        const activeTrader = tradersData.traders?.[0];
        const activeId = activeTrader?.id || "demo";
        // Left blank rather than defaulted here so the "My Business"
        // fallback can be translated at render time — this effect runs once
        // on mount, before the language has been seeded below.
        setTraderName(activeTrader?.business_name || activeTrader?.name || "");
        setTraderPhone(activeTrader?.whatsapp_number || null);
        const pref = activeTrader?.language_pref || "hi";
        setTraderLang(pref);
        traderLangRef.current = pref;
        // Seed the rendered UI from the language this trader already gave us
        // over WhatsApp. LanguageProvider applies its own precedence: an
        // explicit in-app pick (localStorage) outranks this.
        setProfileLanguage(pref);

        const res = await authFetch(`${API_BASE}/api/v1/dashboard/summary/${activeId}`);
      if (res.ok) {
          const data = await res.json();
          setSummary(data);
          setTraderId(data.trader_id);
          await refreshInvoiceHistory(data.trader_id);
        }
      } catch (err) {
        console.warn("Using demo data (backend unavailable)", err);
        setSummary({
          trader_id: "demo",
          month: new Date().getMonth() + 1,
          year: new Date().getFullYear(),
          itc_buckets: { confirmed: 0, fixable_blocked: 0, at_risk: 0, missed: 0, ineligible: 0 },
        });
        setTraderId("demo");
      } finally {
        setLoading(false);
      }
    }
    fetchDashboardData();
    // setProfileLanguage is a useCallback([]) on the provider, so listing it
    // keeps this a genuine mount-only effect rather than silencing the rule.
  }, [setProfileLanguage]);

  // mobile/App.tsx has requested notification permission and forwarded an
  // Expo push token here (window.postMessage, not the MunimNative bridge
  // object -- see mobile/BRIDGE.md) since the CA-dashboard commit, but
  // nothing on this side was ever listening for it, so no token had ever
  // actually reached the backend. This registers it the moment it arrives;
  // a plain browser tab (no native shell, no postMessage ever sent) just
  // never triggers this at all.
  useEffect(() => {
    function handlePushToken(event) {
      let data;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "MUNIM_PUSH_TOKEN" || !data.token) return;
      authFetch(`${API_BASE}/api/v1/dashboard/register-push-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      }).catch(() => {
        // Best-effort -- a failed registration just means this device keeps
        // getting alerts over WhatsApp only, same as before this existed.
      });
    }
    window.addEventListener("message", handlePushToken);
    return () => window.removeEventListener("message", handlePushToken);
  }, []);

  useEffect(() => {
    if (scanState !== "success" || !scanResult) return;
    if (scanResult.status === "FRAUD_FLAGGED") vibrateAlert();
    else if (scanResult.status === "AT_RISK" || scanResult.status === "FIXABLE_BLOCKED") vibrateWarning();
    else if (scanResult.status === "CONFIRMED") {
      vibrateSuccess();
      // Plain HTML5 Audio, not a native bridge call -- this page already
      // runs inside a WebView that's proven to support media APIs (the
      // voice-query recording feature relies on the same WebView-level
      // audio support). Synthesized chime, not a sourced sound file --
      // see frontend/public/verified-chime.wav's own generation script.
      try {
        new Audio("/verified-chime.wav").play().catch(() => {});
      } catch {
        // Autoplay-blocked or unsupported -- never worth failing the scan over.
      }
    }
  }, [scanState, scanResult]);

  // Warm the on-device HSN matcher (index + model download) as soon as the
  // app is open, well before the trader taps "Scan Invoice" — by the time a
  // scan actually completes (after the Gemini round trip) the model has had
  // a real chance to finish loading instead of starting cold.
  useEffect(() => {
    prewarmHSNMatcher();
  }, []);

  // Offline queue: drain whatever's pending as soon as the browser reports
  // a connection, plus once on mount in case items were queued in an
  // earlier session that's only now being reopened online. `online` is the
  // universal baseline here (works in every browser, no feature detection
  // needed) — Background Sync would let the service worker drain the queue
  // even while the PWA tab itself is closed, but that's meaningfully more
  // moving parts for a benefit that doesn't matter for a live demo, where
  // the tab is open. Not worth it under "simplest thing that works".
  useEffect(() => {
    refreshQueuedCount();
    if (navigator.onLine) drainQueuedUploads();

    function handleOnline() {
      drainQueuedUploads();
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  async function refreshInvoiceHistory(id) {
    const invRes = await authFetch(`${API_BASE}/api/v1/dashboard/invoices/${id}`);
    if (invRes.ok) {
      const invData = await invRes.json();
      setInvoiceHistory((invData.invoices || []).slice(0, 20));
    }
  }

  async function refreshQueuedCount() {
    const queued = await getQueuedUploads();
    setQueuedCount(queued.length);
  }

  // The actual network call, shared by a live upload and a drained queue
  // item so both go through identical request-building and response
  // handling — no second copy of this logic to drift out of sync.
  // `options.latitude`/`options.longitude` are the coarse GPS tag from the
  // native shell's capturePhoto bridge (mobile/BRIDGE.md) — omitted
  // entirely (not sent as blank strings) whenever a scan has no location,
  // which is still the common case (plain browser, permission denied, no
  // fix in time).
  async function uploadInvoiceFile(file, fileName, forTraderId, options = {}) {
    const formData = new FormData();
    formData.append("file", file, fileName);
    formData.append("trader_id", forTraderId);
    if (options.latitude !== undefined && options.longitude !== undefined) {
      formData.append("latitude", options.latitude);
      formData.append("longitude", options.longitude);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/webhook/upload-invoice`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const data = await res.json();
      return { ok: res.ok, data };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Success path shared by a live upload and a drained queue item — same
  // toast, same TTS hook via ListenButton, same invoice-history refresh,
  // regardless of which one produced the result. Takes the trader id
  // explicitly rather than reading the `traderId` state closure: the
  // `online`-listener effect below registers its handler once on mount, so
  // a closure over `traderId` captured there would stay frozen at its
  // mount-time value (null) for the lifetime of the listener.
  function applyUploadSuccess(data, forTraderId) {
    const status = data.itc_verdict?.status || "PROCESSING";
    // `diagnosis_hi` is misnamed: backend/app/services/gemini.py's
    // generate_hindi_diagnosis() takes the trader's `language_pref` and asks
    // the model for Marathi or Gujarati *script* accordingly, so whenever
    // that field is populated the prose is in traderLang — not necessarily
    // Hindi. `diagnosis_en` is the raw English verdict reason. Narration
    // language follows the text itself, which is what both the TTS voice
    // picker and the on-device re-narration actually need; the previous
    // `diagnosis_hi ? "hi-IN" : "en-IN"` read Marathi and Gujarati traders
    // their own verdict in a Hindi voice.
    const narrationLang = data.diagnosis_hi ? traderLangRef.current : "en";
    const message = data.diagnosis_hi || data.diagnosis_en || "";
    setScanState("success");
    setScanResult({
      invoiceId: data.invoice_id,
      status,
      itc_amount: data.itc_verdict?.itc_amount || 0,
      // Backend-localized prose stays in `message`; `messageKey` is for the
      // strings this client owns and has to translate itself.
      message,
      messageKey: message ? null : "tr_invoice_processed",
      lang: toSpeechTag(narrationLang),
      hsnHint: null,
      onDevice: false,
      // Soft geographic signal (backend/app/api/webhook.py) — this trader's
      // own scan history says this one is unusually far away. Kept out of
      // `message` on purpose: that string also feeds ListenButton's TTS,
      // whereas this note renders in the UI language. Stored as a bare
      // distance rather than a pre-built English sentence so it can be
      // rendered through t() like everything else on this toast. Never proof
      // of anything, same honesty standard as the rest of the fraud engine —
      // just a distance a CA can choose to look at.
      locationKm: data.location_signal?.anomaly
        ? data.location_signal.distance_from_usual_km
        : null,
    });
    // A FRAUD_FLAGGED toast has to stay up until the trader deliberately
    // dismisses it (see dismissScanToast's biometric gate below) — silently
    // auto-clearing it on this timer would let the exact alert-fatigue
    // click-through that gate exists to prevent happen automatically
    // instead of by tapping X.
    if (status !== "FRAUD_FLAGGED") {
      setTimeout(() => {
        setScanState("idle");
        setScanResult(null);
      }, 8000);
    }
    if (forTraderId) refreshInvoiceHistory(forTraderId);

    // Runs against the real extracted supplier/line-item text, once it
    // actually exists — never against a guess made before the upload. Not
    // awaited: this is a display enrichment on an already-successful scan,
    // not something anything else waits on. Guarded by invoiceId so a match
    // that resolves late can't stomp a *different*, newer scan result if
    // the trader has already moved on to their next invoice.
    const query = hsnMatchQueryFrom(data);
    if (query) {
      matchHSN(query).then((hint) => {
        if (!hint) return;
        setScanResult((prev) => (prev?.invoiceId === data.invoice_id ? { ...prev, hsnHint: hint } : prev));
      });
    }

    narrateOnDevice(data, narrationLang);
  }

  // Re-narrates the verdict the backend already computed using the on-device
  // model (mobile/modules/localLlm.ts via mobile/BRIDGE.md's bridge) instead
  // of trusting the backend's own Gemini-generated diagnosis_hi/diagnosis_en
  // text — an offline-capable alternative for that one step only, per
  // BRIDGE.md. itc_verdict/fraud_result etc. still come entirely from
  // backend/app/domain/*; this never recomputes or second-guesses them, it
  // only rephrases what's already decided. Best-effort: a missing
  // window.MunimNative (not running inside the native shell) or any
  // narration failure just leaves the backend-provided text in place.
  function narrateOnDevice(data, narrationLang) {
    if (typeof window === "undefined" || !window.MunimNative?.isAvailable) return;

    const verdict = {
      status: data.itc_verdict?.status,
      itc_amount: data.itc_verdict?.itc_amount,
      itc_blocked: data.itc_verdict?.itc_blocked,
      reason: data.itc_verdict?.reason,
      supplier_name: data.supplier_name,
    };
    let text = "";
    // Same language the backend's own prose came back in (see
    // applyUploadSuccess) — the on-device model is re-phrasing that verdict,
    // not switching the trader to a different language mid-toast.
    window.MunimNative.explainVerdict(verdict, narrationLang, {
      onToken: (token) => {
        text += token;
        setScanResult((prev) => (prev?.invoiceId === data.invoice_id ? { ...prev, message: text, onDevice: true } : prev));
      },
      onDone: (fullText) => {
        setScanResult((prev) =>
          prev?.invoiceId === data.invoice_id ? { ...prev, message: fullText, onDevice: true } : prev,
        );
      },
      onError: () => {
        // Keep whatever backend-provided diagnosis text is already showing.
      },
    });
  }

  // `reason` distinguishes *why* this queued -- "offline" (navigator.onLine
  // said so before the request even started) vs "failed" (the request
  // itself errored or hit UPLOAD_TIMEOUT_MS after actually being sent).
  // Collapsing both into one generic "No connection" message was actively
  // misleading: a trader on a real, working-but-slow connection would see
  // "no connection" for a request that was genuinely still processing,
  // with no way to tell that apart from actually being offline.
  async function queueForLater(file, forTraderId, options = {}, reason = "offline") {
    await queueUpload(file, { trader_id: forTraderId, ...options });
    await refreshQueuedCount();
    setScanState("queued");
    setScanResult({
      // A key, not a sentence: the toast can outlive a language change, and
      // resolving at render keeps it in whatever language is showing now.
      messageKey: reason === "offline" ? "tr_queued_offline_msg" : "tr_queued_slow_msg",
    });
    setTimeout(() => {
      setScanState("idle");
      setScanResult(null);
    }, 8000);
  }

  // Shapes a failed upload response into a scanResult. The backend's
  // `detail` is English (FastAPI HTTPException text) and translating it
  // belongs on the backend, not here — so it is passed through verbatim only
  // when it carries something a generic translated message would lose. The
  // one failure worth naming in the trader's own language is the Gemini
  // quota wall: it is by far the most common one on a demo key, and "try
  // again tomorrow" is an instruction, not a diagnostic.
  function uploadErrorResult(data, fallbackKey) {
    const detail = typeof data?.detail === "string" ? data.detail : "";
    if (/limit|quota/i.test(detail)) return { messageKey: "tr_quota_reached" };
    return detail ? { message: detail } : { messageKey: fallbackKey };
  }

  async function handleInvoiceUpload(file, options = {}) {
    if (!file || !traderId || traderId === "demo") {
      setScanState("error");
      setScanResult({ messageKey: "tr_no_active_trader" });
      return;
    }

    if (!navigator.onLine) {
      await queueForLater(file, traderId, options, "offline");
      return;
    }

    setScanState("uploading");
    setScanResult(null);

    try {
      const { ok, data } = await uploadInvoiceFile(file, file.name, traderId, options);
      if (ok) {
        applyUploadSuccess(data, traderId);
      } else {
        setScanState("error");
        setScanResult(uploadErrorResult(data, "tr_processing_failed_retry"));
      }
    } catch (err) {
      // Network error or the UPLOAD_TIMEOUT_MS abort firing — either way the
      // photo isn't lost, it goes in the same offline queue a detected
      // navigator.onLine===false would have used. navigator.onLine is
      // checked again here (not just assumed "failed") because a request
      // can also fail with the browser correctly reporting online=true the
      // whole time -- e.g. the backend itself timed out or errored, not the
      // connection.
      await queueForLater(file, traderId, options, navigator.onLine ? "failed" : "offline");
    }
  }

  // Retries every queued upload in order, oldest first, stopping the moment
  // one fails (still offline, or a flaky connection dropped again) rather
  // than burning through retries on every item — the next `online` event
  // picks up where this left off. Guarded by `draining` so an `online`
  // event firing mid-drain (or overlapping the mount-time attempt) can't
  // run two drains concurrently and upload the same file twice.
  async function drainQueuedUploads() {
    if (draining.current) return;
    draining.current = true;
    try {
      const queued = await getQueuedUploads();
      for (const item of queued) {
        if (!navigator.onLine) break;
        try {
          // item.metadata already holds whatever options queueForLater
          // stashed alongside trader_id (e.g. latitude/longitude) — passing
          // it straight through as options is exactly what uploadInvoiceFile
          // expects, no separate shape to keep in sync.
          const { ok, data } = await uploadInvoiceFile(item.file, item.fileName, item.metadata.trader_id, item.metadata);
          await removeQueuedUpload(item.id);
          if (ok) {
            applyUploadSuccess(data, item.metadata.trader_id);
          } else {
            setScanState("error");
            setScanResult(uploadErrorResult(data, "tr_queued_invoice_failed"));
          }
        } catch (err) {
          break;
        }
      }
    } finally {
      draining.current = false;
      await refreshQueuedCount();
    }
  }

  // Uses the native shell's motion-gated camera (mobile/components/
  // SteadyCameraCapture.tsx, via mobile/BRIDGE.md's capturePhoto bridge)
  // when available -- it auto-captures only once the phone has actually
  // held still, instead of the OS camera app's plain manual shutter, which
  // has no way to know or care whether the shot came out blurry. Falls back
  // to the OS file/camera picker in a plain browser (window.MunimNative
  // doesn't exist there) or if the native capture itself genuinely fails
  // (not on a trader-initiated cancel, which just does nothing).
  function triggerScan() {
    if (typeof window !== "undefined" && window.MunimNative?.isAvailable) {
      window.MunimNative.capturePhoto({
        // latitude/longitude are only present when the native shell's best-
        // effort GPS fix (mobile/components/SteadyCameraCapture.tsx) actually
        // resolved — undefined otherwise, so `options` ends up `{}` exactly
        // like every non-native capture path.
        onCaptured: (base64, mimeType, latitude, longitude) => {
          const options = latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {};
          handleFileSelected(base64ToFile(base64, mimeType, `invoice_${Date.now()}.jpg`), options);
        },
        onError: (message) => {
          if (message !== "cancelled") fileInputRef.current?.click();
        },
      }, traderLang);
      return;
    }
    fileInputRef.current?.click();
  }

  function base64ToFile(base64, mimeType, filename) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    return new File([new Uint8Array(byteNumbers)], filename, { type: mimeType });
  }

  // Gate: run the on-device blur/glare check before this file ever reaches
  // handleInvoiceUpload (i.e. before the network round-trip + paid Gemini
  // Vision OCR call). A bad photo shows a retake prompt with the specific
  // reason instead of silently uploading and burning an API call on a scan
  // that's going to come back garbled anyway. Not a hard block — the user
  // can always choose "Upload Anyway", since some real invoices are
  // genuinely hard to photograph cleanly and a false positive shouldn't
  // trap them.
  async function handleFileSelected(file, options = {}) {
    if (!file) return;

    setCheckingPhoto(true);
    const verdict = await analyzeImageFile(file);
    setCheckingPhoto(false);

    if (verdict && !verdict.isAcceptable) {
      setRetakePrompt({ file, verdict, options });
      return;
    }

    handleInvoiceUpload(file, options);
  }

  // Clears the scan-result toast — the X button's only job, except for a
  // FRAUD_FLAGGED result, which is gated behind a biometric prompt first.
  // A trader tapping through a fraud alert without a deliberate confirm is
  // exactly the alert-fatigue click-through that undermines the statistical
  // fraud detection this app runs (Benford's Law, sequential-invoice and
  // velocity checks nobody does manually at a low-cost retainer — see
  // CLAUDE.md's differentiator #2); the native shell's fingerprint/Face ID
  // gate (mobile/modules/bridge.ts, `window.MunimNative.confirmBiometric`)
  // turns "saw it, clicked X" into something a bit more deliberate and
  // auditable. This can NEVER become a hard block, though: a plain browser
  // (no window.MunimNative at all) or a phone with no biometric hardware/
  // enrollment set up falls straight back to the old immediate-dismiss
  // behavior — see BRIDGE.md's "not_available" reason for why that check
  // has to happen after calling confirmBiometric, not before.
  function dismissScanToast() {
    const clear = () => { setScanState("idle"); setScanResult(null); };

    const confirmBiometric = typeof window !== "undefined" ? window.MunimNative?.confirmBiometric : undefined;
    if (scanResult?.status !== "FRAUD_FLAGGED" || typeof confirmBiometric !== "function") {
      clear();
      return;
    }

    confirmBiometric({
      onResult: (success, reason) => {
        // "not_available" means this device can't run the gate at all (no
        // sensor, or nothing enrolled) — never strand the trader behind a
        // prompt their phone can't show.
        if (success || reason === "not_available") clear();
        // Otherwise (cancelled, wrong finger, lockout...) leave the alert
        // open so the trader can look again or retry.
      },
      onError: () => clear(), // bridge/native failure, not a declined prompt — same fallback as "not_available"
    });
  }

  const statusColors = {
    CONFIRMED: "text-[var(--green-primary)]",
    FIXABLE_BLOCKED: "text-[var(--orange-primary)]",
    AT_RISK: "text-[var(--red-primary)]",
    INELIGIBLE: "text-[var(--text-muted)]",
    FRAUD_FLAGGED: "text-[var(--red-primary)]",
  };

  const getRowBackground = (status, fraudScore) => {
    if (fraudScore >= 70) return "bg-red-50/50 border-red-200";
    switch (status) {
      case "FRAUD_FLAGGED":
      case "AT_RISK": return "bg-red-50/50 border-red-200";
      case "FIXABLE_BLOCKED": return "bg-orange-50/50 border-orange-200";
      default: return "bg-white border-[var(--border-subtle)]";
    }
  };

  // A scan result carries either backend prose (`message`, already in the
  // trader's language) or a key this client owns (`messageKey`), never both.
  const scanMessage = scanResult
    ? scanResult.message || (scanResult.messageKey ? t(scanResult.messageKey) : "")
    : "";
  // Backend prose arrives with its own BCP-47 tag (applyUploadSuccess);
  // anything this client wrote is in whatever language the UI is showing.
  const scanMessageLang = scanResult?.message ? scanResult.lang : toSpeechTag(uiLang);

  const statusLabel = (status) =>
    STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status || t("tr_status_pending");

  // utils/imageQuality.js returns its `reason` as an English sentence and is
  // out of scope to change here, so the verdict is re-derived from the two
  // numbers it also returns. Glare is checked first for the same reason the
  // util checks it first: a blown-out region reads as low variance too, and
  // glare is the more actionable diagnosis.
  const retakeReasonKey = (verdict) =>
    verdict?.glareRatio > GLARE_RATIO_THRESHOLD ? "tr_retake_glare" : "tr_retake_blur";

  return (
    <div className="flex flex-col min-h-screen pb-20">
      {/* Hidden file input — mobile camera capture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFileSelected(file);
        }}
      />

      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-white sticky top-0 z-10">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-tight text-black">Munim.ai</h1>
          <span className="text-[10px] uppercase font-bold text-[var(--green-primary)] tracking-widest">{t("tr_active")}</span>
        </div>
        <button className="p-2 -mr-2 text-black" onClick={() => setSidebarOpen(true)}>
          <Menu size={24} />
        </button>
      </header>

      {/* Slide-out Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          {/* Drawer */}
          <div className="relative ml-auto w-72 h-full bg-white flex flex-col shadow-2xl">
            {/* Drawer header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
              <div>
                <p className="font-bold text-black text-base">Munim.ai</p>
                <p className="text-xs text-[var(--text-secondary)] truncate max-w-[180px]">{traderName || t("tr_my_business")}</p>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded hover:bg-[var(--bg-primary)] transition-colors">
                <X size={20} className="text-black" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 p-4 space-y-1">
              {[
                { id: "home",    label: t("tr_nav_dashboard"),       icon: <Home size={18} /> },
                { id: "history", label: t("tr_nav_invoice_history"),  icon: <FileText size={18} /> },
                { id: "reports", label: t("tr_nav_reports"), icon: <BarChart2 size={18} /> },
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === item.id
                      ? "bg-black text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-black"
                  }`}
                >
                  <span className="flex items-center gap-3">{item.icon}{item.label}</span>
                  <ChevronRight size={14} className="opacity-50" />
                </button>
              ))}
            </nav>

            {/* Language picker — the explicit in-app choice that outranks the
                trader's saved language_pref (see LanguageContext's
                setProfileLanguage). Lives in the drawer rather than behind a
                settings screen because changing it is the first thing a
                shopkeeper handed this phone does. */}
            <div className="p-4 border-t border-[var(--border-subtle)]">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-widest mb-2">
                {t("tr_language")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.code}
                    onClick={() => changeLanguage(option.code)}
                    aria-pressed={uiLang === option.code}
                    className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                      uiLang === option.code
                        ? "bg-black text-white"
                        : "border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-black"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sign out -- the "Upload Invoice" button that used to live here
                duplicated the main Scan Invoice action already available
                from the bottom nav bar; this drawer had no way to log out
                at all, unlike the CA dashboard's sidebar, which already has
                one. */}
            <div className="p-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => {
                  localStorage.removeItem("munim_auth_trader");
                  localStorage.removeItem("munim_auth_token");
                  localStorage.removeItem("munim_auth_role");
                  window.location.href = "/";
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-black text-white font-bold text-sm hover:bg-gray-800 transition-colors"
              >
                <LogOut size={16} /> {t("tr_log_out")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* On-device photo quality check — runs before any upload/network call */}
      {checkingPhoto && (
        <div className="mx-4 mt-4 p-4 rounded-none border border-[var(--border-subtle)] bg-white flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-black flex-shrink-0" />
          <p className="font-bold text-black text-sm">{t("tr_checking_photo_quality")}</p>
        </div>
      )}

      {/* Persistent queued-uploads badge — visible independent of the
          transient scan-result toast below, so a judge (or the trader) can
          see queued work even after the "just queued this one" toast has
          auto-dismissed. */}
      {queuedCount > 0 && (
        <div className="mx-4 mt-4 px-3 py-2 rounded-none border border-[var(--orange-primary)] bg-orange-50 flex items-center gap-2">
          <CloudOff size={14} className="text-[var(--orange-primary)] flex-shrink-0" />
          <p className="text-xs font-bold text-[var(--orange-primary)]">
            {/* Separate singular/plural keys rather than an English "s"
                suffix — Hindi, Marathi and Gujarati do not pluralize by
                appending a letter. */}
            {queuedCount === 1 ? t("tr_queued_one") : t("tr_queued_many", { count: queuedCount })}
          </p>
        </div>
      )}

      {/* Scan Result Toast */}
      {scanState !== "idle" && (
        <div className="mx-4 mt-4 p-4 rounded-none border border-[var(--border-subtle)] bg-white flex items-start gap-3">
          {scanState === "uploading" && <Loader2 size={18} className="animate-spin text-black mt-0.5 flex-shrink-0" />}
          {scanState === "success" && <CheckCircle2 size={18} className="text-black mt-0.5 flex-shrink-0" />}
          {scanState === "queued" && <CloudOff size={18} className="text-[var(--orange-primary)] mt-0.5 flex-shrink-0" />}
          {scanState === "error" && <ShieldAlert size={18} className="text-[var(--red-primary)] mt-0.5 flex-shrink-0" />}
          <div className="flex-1">
            {scanState === "uploading" && (
              <>
                <p className="font-bold text-black text-sm">{t("tr_processing_invoice")}</p>
                <p className="text-xs text-[var(--text-secondary)]">{t("tr_processing_checks")}</p>
              </>
            )}
            {scanState === "queued" && scanResult && (
              <>
                <p className="font-bold text-[var(--orange-primary)] text-sm">{t("tr_queued_offline_title")}</p>
                <p className="text-xs text-[var(--text-secondary)]">{scanMessage}</p>
              </>
            )}
            {scanState === "success" && scanResult && (
              <>
                <p className="font-bold text-black text-sm">
                  {t("tr_invoice_analyzed")} —{" "}
                  <span className={statusColors[scanResult.status] || "text-black"}>
                    {statusLabel(scanResult.status)}
                  </span>
                </p>
                {scanResult.itc_amount > 0 && (
                  <p className="text-xs font-bold text-black">
                    {t("tr_itc")}: ₹{scanResult.itc_amount.toLocaleString("en-IN")}
                  </p>
                )}
                <p className="text-xs text-[var(--text-secondary)] mt-1">{scanMessage}</p>
                {scanResult.locationKm != null && (
                  <p className="text-xs text-[var(--orange-primary)] mt-1">
                    {t("tr_location_note", { km: scanResult.locationKm })}
                  </p>
                )}
                <ListenButton text={scanMessage} lang={scanMessageLang} className="mt-1.5" />
                {scanResult.onDevice && (
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 mt-1.5">
                    <Sparkles size={11} />
                    {t("tr_narrated_on_device")}
                  </p>
                )}
                {scanResult.hsnHint && (
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mt-1.5">
                    <Sparkles size={11} />
                    {t("tr_hsn_match")}: {scanResult.hsnHint.hsn_code} ({Math.round(scanResult.hsnHint.confidence * 100)}%)
                  </p>
                )}
              </>
            )}
            {scanState === "error" && scanResult && (
              <>
                <p className="font-bold text-[var(--red-primary)] text-sm">{t("tr_processing_failed_title")}</p>
                <p className="text-xs text-[var(--text-secondary)]">{scanMessage}</p>
              </>
            )}
          </div>
          {scanState !== "uploading" && (
            <button onClick={dismissScanToast}>
              <X size={16} className="text-[var(--text-muted)]" />
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 p-4 overflow-y-auto space-y-6 bg-[var(--bg-primary)]">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={28} className="animate-spin text-black" />
          </div>
        ) : activeTab === "home" ? (
          <>
            <div className="mb-2">
              <VoiceQueryButton traderLang={traderLang} traderId={traderId} />
            </div>
            <div className="mb-2">
              <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t("tr_financial_snapshot")}</h2>
              <MoneyMeter summary={summary} apiBase={API_BASE} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t("tr_required_actions")}</h2>
              <ActionQueue traderId={traderId} apiBase={API_BASE} traderPhone={traderPhone} />
            </div>
          </>
        ) : activeTab === "reports" ? (
          <ReportsPanel traderId={traderId} apiBase={API_BASE} />
        ) : (
          <div>
            <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">{t("tr_invoice_history")}</h2>
            {invoiceHistory.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-muted)] text-sm">{t("tr_no_invoices_yet")}</div>
            ) : (
              <div className="space-y-2">
                {invoiceHistory.map((inv, index) => (
                  <div 
                    key={inv.id} 
                    onClick={() => setSelectedIndex(index)}
                    className={`border rounded-none p-4 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform ${getRowBackground(inv.itc_status, inv.fraud_score)}`}
                  >
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="font-bold text-black text-sm">{inv.supplier_name || inv.gstin_supplier || t("tr_unknown_supplier")}</p>
                        {inv.fraud_score >= 70 && <ShieldAlert size={12} className="text-[var(--red-primary)]" />}
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">{inv.invoice_number} · {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("en-IN") : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-black text-sm">₹{Number(inv.total_amount || 0).toLocaleString("en-IN")}</p>
                      <span className={`text-[10px] font-bold uppercase ${
                        inv.itc_status === "CONFIRMED" ? "text-[var(--green-primary)]" :
                        inv.itc_status === "FIXABLE_BLOCKED" ? "text-[var(--orange-primary)]" :
                        "text-[var(--red-primary)]"
                      }`}>{statusLabel(inv.itc_status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Fixed Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-[var(--border-subtle)] p-4 flex gap-4">
        <button
          onClick={() => setActiveTab(activeTab === "history" ? "home" : "history")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 p-2 transition-colors ${activeTab === "history" ? "text-black" : "text-[var(--text-secondary)] hover:text-black"}`}
        >
          <FileText size={20} />
          <span className="text-[10px] font-bold">{t("tr_history")}</span>
        </button>
        
        {/* Massive Scan Button */}
        <button
          onClick={() => { setActiveTab("home"); triggerScan(); }}
          disabled={scanState === "uploading" || checkingPhoto}
          className="flex-2 flex items-center justify-center gap-2 px-6 py-3 rounded-none bg-black text-white  hover:bg-gray-900 transition-all transform hover:scale-105 w-full disabled:opacity-60 disabled:scale-100"
        >
          {scanState === "uploading" || checkingPhoto ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Camera size={20} />
          )}
          <span className="font-bold text-sm">
            {checkingPhoto ? t("tr_checking_photo") : scanState === "uploading" ? t("tr_processing") : t("tr_scan_invoice")}
          </span>
        </button>
      </div>

      {/* Modal */}
      {selectedIndex !== null && (
        <InvoiceDetailModal
          invoice={invoiceHistory[selectedIndex]}
          onClose={() => setSelectedIndex(null)}
          onNext={() => setSelectedIndex(selectedIndex < invoiceHistory.length - 1 ? selectedIndex + 1 : selectedIndex)}
          onPrev={() => setSelectedIndex(selectedIndex > 0 ? selectedIndex - 1 : selectedIndex)}
          hasNext={selectedIndex < invoiceHistory.length - 1}
          hasPrev={selectedIndex > 0}
        />
      )}

      {/* Retake prompt — on-device blur/glare check failed. Not a hard
          block: the trader can override and upload anyway, since a false
          positive on a genuinely hard-to-photograph invoice shouldn't trap
          them. */}
      {retakePrompt && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-white rounded-none border border-[var(--border-subtle)] p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert size={20} className="text-[var(--orange-primary)] flex-shrink-0" />
              <h2 className="font-bold text-black text-base">{t("tr_photo_may_not_scan")}</h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6">{t(retakeReasonKey(retakePrompt.verdict))}</p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setRetakePrompt(null);
                  triggerScan();
                }}
                className="w-full py-3 rounded-none bg-black text-white font-bold text-sm hover:bg-gray-800 transition-colors"
              >
                {t("tr_retake_photo")}
              </button>
              <button
                onClick={() => {
                  const { file, options } = retakePrompt;
                  setRetakePrompt(null);
                  handleInvoiceUpload(file, options);
                }}
                className="w-full py-3 rounded-none border border-[var(--border-subtle)] text-[var(--text-secondary)] font-bold text-sm hover:bg-[var(--bg-primary)] transition-colors"
              >
                {t("tr_upload_anyway")}
              </button>
            </div>

            <p className="text-[10px] text-[var(--text-muted)] mt-4 text-center">
              {t("tr_checked_on_device")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
