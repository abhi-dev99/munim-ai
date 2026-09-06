"use client";

import { useState, useCallback, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { isRecordingSupported, startRecording, stopRecording } from "../utils/voiceRecording";
import { transcribeAudio } from "../utils/api";
import { matchVoiceIntent, answerVoiceIntent } from "../utils/voiceIntent";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * "Ask Munim" — voice query for a trader's own dashboard summary.
 * Tap the mic, ask something like "mera ITC kitna bacha hai", get an
 * instant answer from data already loaded on this page (see
 * utils/voiceIntent.js's answerVoiceIntent).
 *
 * Recording is getUserMedia/MediaRecorder based (utils/voiceRecording.js),
 * not the Web Speech API -- the mobile app embeds this page inside a React
 * Native WebView (Android System WebView, not Chrome), which has never
 * supported SpeechRecognition. The recorded clip is transcribed server-side
 * via the same Groq Whisper call webhook.py's WhatsApp voice-note handler
 * already uses (utils/api.js's transcribeAudio -> POST
 * /dashboard/transcribe-audio) -- one transcription implementation, two
 * input transports. Everything after getting a transcript (intent matching,
 * the answer itself) is unchanged from before.
 *
 * Renders nothing if the browser/WebView doesn't support audio recording at
 * all, rather than showing a mic that silently fails when tapped.
 */
export default function VoiceQueryButton({ summary, traderLang = "hi" }) {
  const [state, setState] = useState("idle"); // idle | listening | transcribing | answered | error
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const recorderRef = useRef(null);

  const ERROR_MESSAGES = {
    "not-allowed": "Mic permission allow karein settings mein.",
    unsupported: "Ye phone/browser voice input support nahi karta.",
    "transcription-failed": "Awaaz samajhne mein dikkat aayi, dobara try karein.",
  };

  const handleTap = useCallback(async () => {
    if (state === "listening") {
      setState("transcribing");
      try {
        const blob = await stopRecording(recorderRef.current);
        recorderRef.current = null;
        if (!blob || blob.size === 0) {
          // Recording "succeeded" structurally but captured zero audio --
          // a real, distinct failure mode (seen on some WebView/codec
          // combinations) worth telling apart from a transcription error,
          // rather than uploading an empty file and blaming Groq for it.
          setErrorMsg(`${ERROR_MESSAGES["transcription-failed"]} [empty recording]`);
          setState("error");
          return;
        }
        const transcript = await transcribeAudio(API_BASE, blob);
        if (!transcript) {
          setErrorMsg(`${ERROR_MESSAGES["transcription-failed"]} [empty transcript]`);
          setState("error");
          return;
        }
        const { intent } = matchVoiceIntent(transcript, traderLang);
        setAnswer(answerVoiceIntent(intent, summary, traderLang));
        setState("answered");
      } catch (err) {
        // Real error text appended in brackets -- deliberately visible, not
        // logged somewhere unreachable, since there's no way to remotely
        // inspect this WebView's console right now.
        setErrorMsg(`${ERROR_MESSAGES["transcription-failed"]} [${err?.message || err}]`);
        setState("error");
      }
      return;
    }

    setAnswer("");
    setErrorMsg("");
    setState("listening");

    const recorder = await startRecording({
      onError: (code, detail) => {
        const base = ERROR_MESSAGES[code] || "Kuch galat ho gaya, dobara try karein.";
        setErrorMsg(detail ? `${base} [${detail}]` : base);
        setState("error");
      },
    });
    recorderRef.current = recorder;
  }, [state, summary, traderLang]);

  if (!isRecordingSupported()) return null;

  return (
    <div className="rounded-none border border-[var(--border-subtle)] bg-white p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleTap}
          disabled={state === "transcribing"}
          aria-label={state === "listening" ? "Sunna band karein" : "Munim se poochein"}
          className={`flex-none w-11 h-11 rounded-none flex items-center justify-center transition-colors disabled:opacity-50 ${
            state === "listening" ? "bg-red-600 text-white" : "bg-black text-white hover:bg-gray-800"
          }`}
        >
          {state === "transcribing" ? (
            <Loader2 size={18} className="animate-spin" />
          ) : state === "listening" ? (
            <MicOff size={18} />
          ) : (
            <Mic size={18} />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
            Munim se poochein
          </p>
          {state === "listening" && (
            <p className="text-sm text-[var(--text-secondary)] flex items-center gap-1.5 mt-0.5">
              <Loader2 size={13} className="animate-spin" /> Sun raha hoon...
            </p>
          )}
          {state === "transcribing" && (
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">Samajh raha hoon...</p>
          )}
          {state === "answered" && <p className="text-sm font-medium mt-0.5">{answer}</p>}
          {state === "error" && <p className="text-sm text-[var(--red-primary)] mt-0.5">{errorMsg}</p>}
          {state === "idle" && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5">"Mera ITC kitna bacha hai?"</p>
          )}
        </div>
      </div>
    </div>
  );
}
