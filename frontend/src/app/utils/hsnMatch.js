/**
 * On-device HSN semantic match — a client-side HINT layered on top of the
 * upload flow, not a replacement for anything. `backend/app/domain/hsn.py`
 * remains the sole authority on HSN validation (exact lookup, then its own
 * pgvector semantic fallback); this module never talks to that code and its
 * output is attached to the upload as an extra, optional field the backend
 * doesn't need to read.
 *
 * Embeds the trader's line-item text in-browser with a small ONNX sentence
 * model (via @xenova/transformers) and nearest-neighbor matches it against
 * a curated local index of ~540 HSN codes (frontend/public/hsn-index.json,
 * built by frontend/scripts/build-hsn-index.mjs — see that file for what's
 * in the index and why Xenova/all-MiniLM-L6-v2 was used instead of the
 * multilingual model this feature was originally specced with).
 *
 * Every exported async function here fails silently: on a slow/absent
 * network, an unsupported browser, or a low-confidence result, `matchHSN`
 * resolves to `null` and the caller proceeds exactly as if this module
 * didn't exist. Same additive, never-blocking pattern as the photo-quality
 * gate (imageQuality.js) and the offline queue.
 */

// Mirrors backend/app/domain/hsn.py's own pgvector `match_threshold` (0.5)
// for the semantic fallback pass — different embedding space, same intent:
// below this, a "best" match is closer to noise than signal.
const CONFIDENCE_THRESHOLD = 0.5;

// Generous but bounded — covers a cold model download on a slow connection
// without ever making the trader wait meaningfully longer than the upload
// itself would take. A timeout here means "don't wait for it", not "cancel
// it" — the model keeps loading in the background and, if it finishes, sits
// in the browser cache ready for the next scan.
const MATCH_TIMEOUT_MS = 4000;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const INDEX_URL = "/hsn-index.json";

let indexPromise = null;
let embedderPromise = null;

// Both loaders cache their promise at module scope so a warm second scan
// (or the mount-time prewarm) doesn't redo the fetch/download — but clear
// that cache on failure rather than caching the rejection, so a transient
// network blip (the whole reason this product exists) doesn't permanently
// disable the feature for the rest of the session.
function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`hsn-index.json fetch failed: ${res.status}`);
        return res.json();
      })
      .catch((err) => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

function loadEmbedder() {
  if (!embedderPromise) {
    embedderPromise = import("@xenova/transformers")
      .then(({ pipeline }) => pipeline("feature-extraction", MODEL_ID, { quantized: true }))
      .catch((err) => { embedderPromise = null; throw err; });
  }
  return embedderPromise;
}

/** Plain cosine similarity — both inputs are expected pre-normalized
 * (the index and the query embedding both come from the same
 * `{normalize: true}` pooling), so this is just a dot product, but written
 * as true cosine similarity so it stays correct if that ever changes. */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Pure nearest-neighbor search over the curated index — no model, no
 * network, easily unit-testable. Returns `null` if the index is empty or
 * nothing clears `threshold`.
 */
export function findBestHSNMatch(queryEmbedding, rows, threshold = CONFIDENCE_THRESHOLD) {
  let best = null;
  let bestScore = -Infinity;
  for (const row of rows) {
    const score = cosineSimilarity(queryEmbedding, row.e);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best || bestScore < threshold) return null;
  return {
    hsn_code: best.c,
    description: best.d,
    gst_rate: best.r,
    confidence: bestScore,
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hsn match timed out")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function runMatch(description) {
  const [index, embedder] = await Promise.all([loadIndex(), loadEmbedder()]);
  const output = await embedder(description, { pooling: "mean", normalize: true });
  return findBestHSNMatch(Array.from(output.data), index.rows);
}

/**
 * Best-effort on-device HSN match for a line-item description. Never
 * throws, never blocks the caller beyond `MATCH_TIMEOUT_MS`. Returns
 * `{ hsn_code, description, gst_rate, confidence }` or `null`.
 */
export async function matchHSN(description) {
  if (!description?.trim()) return null;
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") return null;

  try {
    return await withTimeout(runMatch(description), MATCH_TIMEOUT_MS);
  } catch (err) {
    console.warn("On-device HSN match skipped.", err);
    return null;
  }
}

/**
 * Fire-and-forget: starts the index fetch + model download in the
 * background (e.g. on app mount) so that by the time a trader actually
 * captures an invoice, `matchHSN` has a real chance of finishing inside the
 * short window the upload flow is willing to wait for it, instead of always
 * missing it on a cold first scan. Safe to call from anywhere — swallows
 * every failure, same as `matchHSN`.
 */
export function prewarmHSNMatcher() {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") return;
  Promise.all([loadIndex(), loadEmbedder()]).catch(() => {});
}
