// The backend's /api/v1/admin/* router requires this header (see
// ADMIN_API_KEY in backend/.env) since it has no per-user login of its
// own -- it's a shared dev/ops surface (Gemini key pool, system status,
// admin invoice delete), not something a trader or CA authenticates into.
//
// This key is NEVER built into the bundle. It used to come from
// NEXT_PUBLIC_ADMIN_API_KEY, which Next.js inlines into the client
// JavaScript -- meaning the production key that gates DELETE
// /api/v1/admin/invoices/{id} was downloadable by anyone who opened the
// site. An operator now types it once per browser session instead; it
// lives in sessionStorage and nowhere else, so it is never published to
// the repo, the build logs, or the served bundle.
const ADMIN_KEY_STORAGE = "munim_admin_key";

export const getAdminKey = () => {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
  } catch {
    return "";
  }
};

export const setAdminKey = (key) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, (key || "").trim());
  } catch {
    /* private mode / storage disabled -- admin calls will 403, which is correct */
  }
};

export const clearAdminKey = () => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
};

export const adminHeaders = () => {
  const key = getAdminKey();
  return key ? { "X-Admin-Key": key } : {};
};

// Ask for the key once per session. Only the internal ops surfaces (/dev,
// /admin) should call this -- user-facing pages like /dashboard render
// admin-backed widgets too, and a CA must never be prompted for an ops
// credential. Those callers just use adminHeaders() and degrade quietly
// to an empty header when no key is present.
export const ensureAdminKey = () => {
  if (typeof window === "undefined") return "";
  if (getAdminKey()) return getAdminKey();
  const entered = window.prompt(
    "Admin key required for this internal tool.\n\n" +
      "Held in this browser session only -- it is not stored in the app bundle."
  );
  if (entered && entered.trim()) setAdminKey(entered);
  return getAdminKey();
};

// Uploads a recorded voice-query clip (see utils/voiceRecording.js) to the
// backend for transcription and returns the transcript text. Thin wrapper
// so VoiceQueryButton.js doesn't need to know the endpoint shape.
export const transcribeAudio = async (apiBase, blob) => {
  const formData = new FormData();
  formData.append("audio", blob, "voice-query.webm");
  const res = await authFetch(`${apiBase}/api/v1/dashboard/transcribe-audio`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Transcription failed");
  const data = await res.json();
  return data.text || "";
};

// Sends a transcribed voice (or future typed) question to the same
// LLM-backed answer engine WhatsApp's text/voice queries already use
// (backend/app/services/gemini.py::answer_trader_question, via the new
// /dashboard/ask/{traderId} endpoint) -- real, flexible answers instead of
// utils/voiceIntent.js's fixed 3-intent local matcher.
export const askTraderQuestion = async (apiBase, traderId, question) => {
  const res = await authFetch(`${apiBase}/api/v1/dashboard/ask/${traderId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error("Ask failed");
  const data = await res.json();
  return data.answer || "";
};

export const authFetch = async (url, options = {}) => {
  options.cache = 'no-store';
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('munim_auth_token');
    if (token) {
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };
    }
  }
  const res = await fetch(url, options);
  
  if (res.status === 401 && typeof window !== 'undefined') {
    // Prevent redirect loop if already on login page or dev portal
    if (window.location.pathname !== "/" && window.location.pathname !== "/dev") {
      localStorage.removeItem('munim_auth_token');
      localStorage.removeItem('munim_auth_trader');
      window.location.href = "/";
    }
  }
  
  return res;
};
