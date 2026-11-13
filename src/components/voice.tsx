"use client";

import { useEffect, useRef, useState } from "react";
import { CircleStop, Mic, X } from "lucide-react";
import { workspaceJson, WorkspaceReconnectError } from "./client";
import { Busy } from "./ui";

type BrowserRecognizer = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export function Voice({ onTranscript, onReconnect, disabled, preferCloudflare }: {
  onTranscript: (text: string) => void; onReconnect: () => void; disabled?: boolean; preferCloudflare?: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "permission" | "listening" | "processing">("idle");
  const [error, setError] = useState("");
  const recording = useRef<MediaRecorder | null>(null);
  const recognition = useRef<BrowserRecognizer | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cancelled = useRef(false);
  const onResult = useRef(onTranscript);
  useEffect(() => { onResult.current = onTranscript; }, [onTranscript]);

  useEffect(() => () => {
    cancelled.current = true;
    window.clearTimeout(timer.current);
    controller.current?.abort();
    recognition.current?.abort();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stop() {
    window.clearTimeout(timer.current);
    recognition.current?.stop();
    if (recording.current?.state === "recording") recording.current.stop();
  }

  function cancel() {
    cancelled.current = true;
    controller.current?.abort();
    window.clearTimeout(timer.current);
    const recognizer = recognition.current;
    recognition.current = null;
    recognizer?.abort();
    const recorder = recording.current;
    recording.current = null;
    if (recorder?.state === "recording") recorder.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setMode("idle");
  }

  async function start() {
    setError("");
    cancelled.current = false;
    const browser = window as Window & { SpeechRecognition?: new () => BrowserRecognizer; webkitSpeechRecognition?: new () => BrowserRecognizer };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (Recognition && (!preferCloudflare || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)) {
      try {
        const instance = new Recognition();
        instance.lang = "en-ZA";
        instance.interimResults = false;
        instance.onresult = (event) => {
          const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
          if (recognition.current === instance && transcript) onResult.current(transcript);
        };
        instance.onerror = (event) => { if (recognition.current === instance) setError(event.error === "not-allowed" ? "Allow microphone access or type your request." : "Voice input did not return a transcript. Try again or type your request."); };
        instance.onend = () => {
          if (recognition.current !== instance) return;
          window.clearTimeout(timer.current);
          recognition.current = null;
          setMode("idle");
        };
        recognition.current = instance;
        instance.start();
        setMode("listening");
        timer.current = window.setTimeout(stop, 45000);
        return;
      } catch {
        recognition.current = null;
      }
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Voice recording is unavailable in this browser. Type your request instead.");
      setMode("permission");
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled.current) { mediaStream.getTracks().forEach((track) => track.stop()); return; }
      stream.current = mediaStream;
      const recorder = new MediaRecorder(mediaStream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        mediaStream.getTracks().forEach((track) => track.stop());
        if (cancelled.current || recording.current !== recorder) return;
        stream.current = null;
        recording.current = null;
        if (!chunks.length) {
          setError("No audio was recorded. Try again or type your request.");
          setMode("idle");
          return;
        }
        setMode("processing");
        const abort = new AbortController();
        controller.current = abort;
        const data = new FormData();
        const mime = recorder.mimeType || "audio/webm";
        data.append("audio", new Blob(chunks, { type: mime }), mime.includes("mp4") ? "request.m4a" : "request.webm");
        try {
          const { response, data: result } = await workspaceJson<{ text?: string }>("/api/transcribe", { method: "POST", body: data, signal: abort.signal });
          if (!response.ok || !result.text) throw new Error(result.error ?? "The recording did not return a transcript. Type your request instead.");
          if (!abort.signal.aborted) onResult.current(result.text);
        } catch (caught) {
          if (abort.signal.aborted) return;
          if (caught instanceof WorkspaceReconnectError) {
            onReconnect();
            setError("Reconnect to StockPact, then record again.");
          } else setError(caught instanceof Error ? caught.message : "Transcription is unavailable. Type your request instead.");
        } finally {
          if (!abort.signal.aborted) setMode("idle");
        }
      };
      recording.current = recorder;
      recorder.start();
      setMode("listening");
      timer.current = window.setTimeout(stop, 45000);
    } catch (caught) {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      if (!cancelled.current) {
        setError(caught instanceof Error && caught.name !== "NotAllowedError" ? caught.message : "Allow microphone access or type your request.");
        setMode("idle");
      }
    }
  }

  return <>
    <div className="voice-control">
    {(mode === "idle" || mode === "permission") && <button type="button" className="icon-button" aria-label="Use voice input" title="Use voice input" disabled={disabled || mode === "permission"} onClick={() => void start()}><Mic size={18} /></button>}
    {mode === "listening" && <div className="voice-actions"><button type="button" className="icon-button" aria-label="Stop recording" onClick={stop}><CircleStop size={18} /></button><button type="button" className="icon-button" aria-label="Cancel recording" onClick={cancel}><X size={16} /></button></div>}
    {mode === "processing" && <div className="voice-actions"><Busy label="Transcribing" /><button type="button" className="icon-button" aria-label="Cancel transcription" onClick={cancel}><X size={16} /></button></div>}
    </div>
    {(error || mode === "listening" || mode === "permission") && <div role="status" className={error ? "voice-feedback voice-error" : "voice-feedback"}>
      {error || (mode === "permission" ? "Waiting for microphone permission…" : "Recording. Tap stop when you’re done.")}
    </div>}
  </>;
}
