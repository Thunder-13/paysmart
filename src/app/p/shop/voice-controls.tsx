"use client";
/**
 * Talk to Pay (voice add-on). Web Speech API wrappers plus three small controls:
 * dictation into the intent box, a read-aloud toggle, and a one-shot "listen for approval".
 * Every control is a native button, so the keyboard path always works; unsupported browsers get
 * disabled controls with a note.
 */
import { useState, useSyncExternalStore } from "react";
import { detectSpeechSupport, parseVoiceCommand, type ParsedVoiceCommand, type SpeechSupport } from "@/pipelines/shop/voice";

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionEventLike {
  results: ArrayLike<ArrayLike<RecognitionAlternative>>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

const NONE: SpeechSupport = { recognition: false, synthesis: false };
let cachedSupport: SpeechSupport | null = null;

function readSupport(): SpeechSupport {
  if (typeof window === "undefined") return NONE;
  if (!cachedSupport) cachedSupport = detectSpeechSupport(window);
  return cachedSupport;
}

function subscribe(): () => void {
  return () => undefined;
}

/** Browser speech support; "none" during server render and hydration. */
export function useSpeechSupport(): SpeechSupport {
  return useSyncExternalStore(subscribe, readSupport, () => NONE);
}

/** Speaks each line in order, cancelling anything already queued. */
export function speak(lines: string[]): void {
  if (typeof window === "undefined" || !readSupport().synthesis) return;
  window.speechSynthesis.cancel();
  for (const text of lines) {
    if (!text) continue;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }
}

/** One-shot recognition: resolves with the best transcript ("" when nothing was heard). */
export function listenOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      reject(new Error("Speech recognition isn't available in this browser."));
      return;
    }
    const rec = new Ctor();
    let heard = "";
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const first = e.results[0]?.[0];
      if (first) heard = first.transcript;
    };
    rec.onerror = (e) => reject(new Error(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech recognition stopped (${e.error ?? "error"}).`));
    rec.onend = () => resolve(heard);
    rec.start();
  });
}

const BTN =
  "inline-flex h-11 items-center gap-2 rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55 aria-[pressed=true]:border-pp-blue aria-[pressed=true]:bg-pp-sky-wash";

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="7" y="2.5" width="6" height="10" rx="3" />
      <path d="M4 9.5a6 6 0 0 0 12 0M10 15.5v2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Mic button that dictates one phrase and hands it back. */
export function DictateButton({ onText, disabled = false }: { onText: (text: string) => void; disabled?: boolean }) {
  const support = useSpeechSupport();
  const [state, setState] = useState<{ listening: boolean; note: string | null }>({ listening: false, note: null });
  async function go() {
    setState({ listening: true, note: "Listening…" });
    try {
      const text = (await listenOnce()).trim();
      if (text) onText(text);
      setState({ listening: false, note: text ? `Heard: "${text}"` : "Didn't catch that. Try again or type." });
    } catch (e) {
      setState({ listening: false, note: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        className={BTN}
        onClick={() => void go()}
        disabled={disabled || !support.recognition || state.listening}
        aria-pressed={state.listening}
        title={support.recognition ? "Dictate your request" : "Dictation needs a browser with speech recognition (Chrome or Edge)."}
      >
        <MicIcon />
        {state.listening ? "Listening" : "Dictate"}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-ink-soft">
        {support.recognition ? state.note : "Dictation isn't available in this browser; type instead."}
      </span>
    </span>
  );
}

/** Read-aloud switch plus an optional "read the slip" button. */
export function ReadAloudControls({
  enabled,
  onChange,
  onReadSlip,
}: {
  enabled: boolean;
  onChange: (on: boolean) => void;
  onReadSlip?: () => void;
}) {
  const support = useSpeechSupport();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className={`inline-flex min-h-11 items-center gap-2.5 text-sm ${support.synthesis ? "cursor-pointer text-ink" : "cursor-not-allowed text-ink-faint"}`}>
        <input
          type="checkbox"
          className="h-4 w-4 accent-pp-blue disabled:cursor-not-allowed"
          checked={enabled && support.synthesis}
          disabled={!support.synthesis}
          onChange={(e) => onChange(e.target.checked)}
        />
        Read slip and stamps aloud
      </label>
      {onReadSlip ? (
        <button type="button" className={BTN} onClick={onReadSlip} disabled={!support.synthesis}>
          Read slip
        </button>
      ) : null}
      {!support.synthesis ? <span className="text-xs text-ink-faint">Speech output isn&apos;t available in this browser.</span> : null}
    </span>
  );
}

/** Listens once for "approve cart", "reject cart" or "option two" and reports what it heard. */
export function ListenForApproval({
  enabled,
  onCommand,
}: {
  enabled: boolean;
  onCommand: (cmd: ParsedVoiceCommand, heard: string) => void | Promise<void>;
}) {
  const support = useSpeechSupport();
  const [state, setState] = useState<{ listening: boolean; note: string | null }>({ listening: false, note: null });
  async function go() {
    setState({ listening: true, note: 'Listening for "approve cart" or "option two"…' });
    try {
      const heard = (await listenOnce()).trim();
      const cmd = parseVoiceCommand(heard);
      if (!cmd) {
        setState({ listening: false, note: heard ? `Heard "${heard}". That isn't a command here; say "option two" or "approve cart", or use the buttons.` : "Didn't catch that. Say \"option two\" or \"approve cart\", or use the buttons." });
        return;
      }
      setState({ listening: false, note: `Heard: "${heard}"` });
      await onCommand(cmd, heard);
    } catch (e) {
      setState({ listening: false, note: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="button" className={BTN} onClick={() => void go()} disabled={!enabled || !support.recognition || state.listening} aria-pressed={state.listening}>
        <MicIcon />
        Listen for approval
      </button>
      <span role="status" aria-live="polite" className="text-xs text-ink-soft">
        {support.recognition ? state.note : "Voice approval needs speech recognition; the buttons work everywhere."}
      </span>
    </span>
  );
}
