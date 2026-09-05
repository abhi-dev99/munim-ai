/**
 * On-device LLM narration of an already-computed GST verdict.
 *
 * Scope note (do not expand): this module does ONE job — turn a verdict
 * object the deterministic backend engine (backend/app/domain/itc_engine.py,
 * backend/app/domain/fraud.py) already produced into a short natural-language
 * explanation, entirely on-device. It mirrors the *existing* Gemini
 * explanation call (`generate_hindi_diagnosis` in backend/app/services/
 * gemini.py, wired through backend/app/agents/invoice_agent.py) as an
 * offline-capable alternative for that one step. It does NOT do OCR, does
 * NOT decide ITC eligibility/fraud, and does NOT invent compliance logic —
 * the verdict fields it narrates are handed to it, not derived by it.
 *
 * Model choice: Llama-3.2-1B-Instruct, GGUF, Q4_K_M quantization
 * (bartowski/Llama-3.2-1B-Instruct-GGUF on Hugging Face).
 *   - ~770 MB on disk (807,694,464 bytes measured via HEAD request against
 *     the HF resolve URL below) — the smallest realistic instruct-tuned GGUF
 *     class, which matters for a first-use download on a loaner phone over
 *     event wifi within a 30-hour build window.
 *   - 1B-class models are well past the point of reliably filling a fixed
 *     5-6 line WhatsApp-style template from structured JSON input (this is
 *     a templated-narration task, not open-ended reasoning), which is what
 *     `generate_hindi_diagnosis`'s prompt actually asks for.
 *   - llama.cpp/llama.rn support for the Llama family is the most mature and
 *     tested path in the project (vs. e.g. Qwen2.5, which some llama.cpp
 *     versions have had chat-template/tokenizer quirks with) — lowest risk
 *     under a hackathon clock.
 *   - Trade-off, stated plainly: Qwen2.5-1.5B-Instruct-GGUF is reported to
 *     have somewhat stronger multilingual/Hindi behavior in community
 *     benchmarks. It was not picked as the default because it is a larger
 *     download (~1.0-1.1 GB at Q4_K_M) for a benefit that mostly matters for
 *     Devanagari Hindi — and the existing backend prompt template
 *     deliberately asks for Hinglish in *Roman* script for the "hi" case
 *     (see PROMPT_LANGUAGE_HINT below, mirrored from gemini.py), which is
 *     much closer to English token distribution and easier for a small
 *     Llama model to produce correctly. Swapping the model is a one-line
 *     change to MODEL_URL/MODEL_FILENAME/MODEL_SIZE_BYTES below if a real
 *     device test shows Qwen narrates noticeably better.
 *
 * The GGUF file is downloaded at runtime on first use into the app's
 * document directory — it is NOT committed to git and NOT bundled into the
 * app binary (a 770 MB binary asset would blow up app size and git history
 * for no benefit; every user needs to fetch it once regardless).
 *
 * GPU note: n_gpu_layers is set below so llama.rn offloads to Adreno OpenCL
 * when the device supports it, with automatic fallback to CPU otherwise —
 * that fallback is the only thing actually verified as working without a
 * physical device. Hexagon NPU execution (llama.cpp's HTP backend, gated by
 * the `enableOpenCLAndHexagon` config-plugin option in app.json) is
 * experimental upstream and requires Snapdragon 8 Gen 1+/HTP hardware; this
 * module does not request an HTP device and NPU execution has not been
 * confirmed working on any real hardware in this project.
 */

import { Directory, File, Paths } from 'expo-file-system'
import { initLlama, type LlamaContext } from 'llama.rn'

// --- Model configuration -----------------------------------------------

const MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf'
const MODEL_FILENAME = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'
// Measured via `curl -sI` against the resolve URL above (Sep 2026). Used as
// a fallback total for progress reporting and as a sanity floor to detect a
// truncated/partial download from a previous crashed run.
const MODEL_SIZE_BYTES = 807_694_464

// expo-file-system's current (SDK 54+) API is class-based (Paths/File/
// Directory) rather than the older documentDirectory string + *Async
// function API. See https://docs.expo.dev/versions/latest/sdk/filesystem/.
const modelDirectory = new Directory(Paths.document, 'models')
const modelFile = new File(modelDirectory, MODEL_FILENAME)

// A file smaller than this after a "successful" download is treated as
// corrupt/partial rather than trusted.
const MIN_VALID_MODEL_BYTES = 100 * 1024 * 1024

// --- Types ---------------------------------------------------------------

export type ModelStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error'

export type ModelProgress = {
  status: ModelStatus
  downloadedBytes?: number
  totalBytes?: number
  fraction?: number
  message?: string
}

export type Verdict = {
  status: string
  itc_amount: number
  itc_blocked?: number
  blocked_reason?: string
  reason?: string
  fix_action?: string
  supplier_name?: string
  invoice_number?: string
  total_amount?: number
  fraud_score?: number
  [key: string]: unknown
}

export type Lang = 'hi' | 'en'

export type ProgressListener = (progress: ModelProgress) => void

// --- Module state ----------------------------------------------------------

let context: LlamaContext | null = null
let loadingPromise: Promise<void> | null = null
const progressListeners = new Set<ProgressListener>()

function emitProgress(progress: ModelProgress) {
  for (const listener of progressListeners) {
    try {
      listener(progress)
    } catch {
      // a listener throwing must never break model loading
    }
  }
}

export function onModelProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

// --- Download + load -------------------------------------------------------

export async function isModelDownloaded(): Promise<boolean> {
  // Must match the full expected size, not just clear a low safety floor --
  // a download aborted partway (e.g. an app reload mid-fetch) can easily
  // land well past MIN_VALID_MODEL_BYTES while still being a truncated GGUF
  // that llama.cpp fails to parse with an opaque "Failed to load model".
  return modelFile.exists && modelFile.size >= MODEL_SIZE_BYTES
}

async function downloadModel(): Promise<void> {
  if (!modelDirectory.exists) {
    modelDirectory.create({ intermediates: true, idempotent: true })
  }

  if (await isModelDownloaded()) {
    emitProgress({ status: 'downloading', fraction: 1, downloadedBytes: MODEL_SIZE_BYTES, totalBytes: MODEL_SIZE_BYTES })
    return
  }

  emitProgress({ status: 'downloading', fraction: 0, downloadedBytes: 0, totalBytes: MODEL_SIZE_BYTES })

  await File.downloadFileAsync(MODEL_URL, modelFile, {
    // Overwrite a truncated/partial file left behind by a previous crashed
    // run rather than throwing DestinationAlreadyExists.
    idempotent: true,
    onProgress: (data) => {
      const totalBytes = data.totalBytes > 0 ? data.totalBytes : MODEL_SIZE_BYTES
      emitProgress({
        status: 'downloading',
        downloadedBytes: data.bytesWritten,
        totalBytes,
        fraction: totalBytes ? data.bytesWritten / totalBytes : 0,
      })
    },
  })

  if (!(await isModelDownloaded())) {
    throw new Error('Model download completed but the file looks truncated or corrupt')
  }
}

/**
 * Downloads the GGUF model on first call (no-op if already present) and
 * initializes a llama.rn context. Safe to call multiple times concurrently
 * — later callers await the same in-flight load rather than starting a
 * second one.
 */
export async function loadModel(): Promise<void> {
  if (context) {
    emitProgress({ status: 'ready' })
    return
  }
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      await downloadModel()
      // eslint-disable-next-line no-console
      console.log('[localLlm] model file before init:', {
        uri: modelFile.uri,
        exists: modelFile.exists,
        size: modelFile.exists ? modelFile.size : 0,
        expectedSize: MODEL_SIZE_BYTES,
      })

      emitProgress({ status: 'loading', message: 'Initializing model context' })
      context = await initLlama({
        model: modelFile.uri,
        n_ctx: 2048,
        // Force the Hexagon NPU specifically (confirmed present on this
        // device: a baseline run without this override already reported
        // devices: ["GPUOpenCL", "HTP0".."HTP5"], gpu: true — this pins
        // execution to HTP0 alone so a real run proves NPU-only inference
        // rather than "NPU was merely available but GPU did the work". The
        // actual outcome is on context.gpu / context.devices /
        // context.reasonNoGPU, logged below.
        devices: ['HTP0'],
        n_gpu_layers: 99,
        // Avoid mlock — loaner-device RAM headroom is unknown, and locking
        // ~800MB of a 1B model's weights in RAM is an easy way to get the
        // whole app OOM-killed on a mid-range phone.
        use_mlock: false,
      })
      // eslint-disable-next-line no-console
      console.log('[localLlm] backend after init:', {
        gpu: context.gpu,
        devices: context.devices,
        reasonNoGPU: context.reasonNoGPU,
      })
      emitProgress({ status: 'ready' })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[localLlm] init threw:', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        modelFileExists: modelFile.exists,
        modelFileSize: modelFile.exists ? modelFile.size : 0,
      })
      emitProgress({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  })().finally(() => {
    loadingPromise = null
  })

  return loadingPromise
}

export function isModelLoaded(): boolean {
  return context !== null
}

export type BackendInfo = { gpu: boolean; devices?: string[]; reasonNoGPU: string }

/**
 * Which backend the loaded context actually ran on (e.g. devices: ["HTP0"]
 * for the Hexagon NPU vs ["GPUOpenCL"] for the Adreno GPU vs unset/empty for
 * CPU) — surfaced so the UI can show real proof of hardware acceleration
 * instead of that only existing in a laptop's Metro log.
 */
export function getBackendInfo(): BackendInfo | null {
  if (!context) return null
  return { gpu: context.gpu, devices: context.devices, reasonNoGPU: context.reasonNoGPU }
}

export async function unloadModel(): Promise<void> {
  if (context) {
    await context.release()
    context = null
  }
}

/** Cancels an in-flight explainVerdict() generation, if any. */
export async function stopExplaining(): Promise<void> {
  if (context) {
    await context.stopCompletion()
  }
}

// --- Verdict narration -------------------------------------------------

// Mirrors backend/app/services/gemini.py::generate_hindi_diagnosis's
// language handling for the two languages the native bridge exposes today
// (mobile/BRIDGE.md documents the "hi" | "en" contract). "hi" is Hinglish
// in Roman script by deliberate product choice in the backend prompt, not
// Devanagari — this narration mirrors that exactly.
const PROMPT_LANGUAGE_HINT: Record<Lang, string> = {
  hi: 'Hindi written in Hinglish/Roman script (English letters only). Do NOT use Devanagari script.',
  en: 'plain English.',
}

const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|EOT|>',
  '<|END_OF_TURN_TOKEN|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
]

const STATUS_EMOJI: Record<string, string> = {
  CONFIRMED: '✅',
  FIXABLE_BLOCKED: '⚠️',
  AT_RISK: '🚨',
  MISSED: '💰',
  INELIGIBLE: '🚫',
  FRAUD_FLAGGED: '🚫',
}

function buildMessages(verdict: Verdict, lang: Lang) {
  const emojiHint = STATUS_EMOJI[verdict.status] ?? '📄'

  // System prompt intentionally mirrors the STRICT FORMAT rules in
  // generate_hindi_diagnosis() (backend/app/services/gemini.py) so the
  // on-device narration reads like the same product, not a different voice.
  const system =
    `You are a GST invoice compliance assistant for a small Indian trader, writing a SHORT WhatsApp-style ` +
    `diagnosis message in ${PROMPT_LANGUAGE_HINT[lang]}\n\n` +
    `STRICT FORMAT (exactly 5 to 6 lines total, no extra lines, no markdown headers):\n` +
    `${emojiHint} <short "Invoice processed!" or "Invoice issue hai!" style opening line>\n` +
    `*Supplier Name* — Bill #BillNo\n` +
    `Taxable: ₹Taxable | Total: ₹Total\n` +
    `💰 *ITC Status: ₹Amount*\n` +
    `<one short line on the reason or the fix action needed>\n\n` +
    `Rules: use ONLY the actual values given in the data below, never placeholder text; no bullet points; ` +
    `no links; no mention of any dashboard (this message goes to a trader, not a CA).`

  const user = JSON.stringify({
    supplier_name: verdict.supplier_name || 'Unknown',
    invoice_number: verdict.invoice_number || '(not available)',
    total_amount: verdict.total_amount ?? 0,
    itc_status: verdict.status,
    itc_amount_eligible: verdict.itc_amount ?? 0,
    itc_amount_blocked: verdict.itc_blocked ?? 0,
    block_reason: verdict.blocked_reason || verdict.reason || 'None',
    fix_action: verdict.fix_action || 'None',
    fraud_score: verdict.fraud_score ?? 0,
  })

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

/**
 * Streams a short natural-language narration of `verdict`, token by token,
 * entirely on-device. Loads the model first if it isn't loaded yet (which
 * may include a first-run download — listen via onModelProgress() to show
 * that in UI). The generator's return value is the full assembled text.
 */
export async function* explainVerdict(
  verdict: Verdict,
  lang: Lang = 'hi',
): AsyncGenerator<string, string, void> {
  if (!context) {
    await loadModel()
  }
  if (!context) {
    throw new Error('Local model is not loaded')
  }
  const ctx = context

  // Bridges llama.rn's callback-based token streaming into an async
  // generator via a small pull queue — there is no native async-iterator
  // API on LlamaContext.completion() to delegate to directly.
  const queue: string[] = []
  let waiter: ((result: IteratorResult<string>) => void) | null = null
  let finished = false
  let failure: Error | null = null

  const pushToken = (token: string) => {
    if (waiter) {
      const resolve = waiter
      waiter = null
      resolve({ value: token, done: false })
    } else {
      queue.push(token)
    }
  }

  const settle = () => {
    finished = true
    if (waiter) {
      const resolve = waiter
      waiter = null
      resolve({ value: undefined as unknown as string, done: true })
    }
  }

  const completionPromise = ctx
    .completion(
      {
        messages: buildMessages(verdict, lang),
        n_predict: 220,
        temperature: 0.6,
        stop: STOP_WORDS,
      },
      (data) => {
        if (data.token) pushToken(data.token)
      },
    )
    .then((result) => {
      settle()
      return result.text
    })
    .catch((err) => {
      failure = err instanceof Error ? err : new Error(String(err))
      settle()
      return ''
    })

  while (true) {
    if (queue.length > 0) {
      yield queue.shift() as string
      continue
    }
    if (finished) break
    const next = await new Promise<IteratorResult<string>>((resolve) => {
      waiter = resolve
    })
    if (next.done) break
    yield next.value
  }

  const fullText = await completionPromise
  if (failure) throw failure
  return fullText
}
