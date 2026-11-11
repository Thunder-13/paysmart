"use client";
import { useId, useState, type DragEvent } from "react";

export interface UploadedFile {
  ref: string;
  contentType: string;
  base64: string;
}

export interface FileDropProps {
  /** input accept attribute, e.g. "image/*" or "image/png,image/jpeg". */
  accept: string;
  onUploaded: (file: UploadedFile) => void;
  label?: string;
  /** Optional pre-upload step, e.g. downscale a photo to 1280 px JPEG. */
  transform?: (file: File) => Promise<{ contentType: string; base64: string }>;
  disabled?: boolean;
  className?: string;
}

const MAX_BYTES = 2 * 1024 * 1024;

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Drag-and-drop or click-to-pick upload to /api/blobs (2 MB limit). */
export function FileDrop({ accept, onUploaded, label = "Drop a file here or choose one", transform, disabled = false, className = "" }: FileDropProps) {
  const id = useId();
  const [state, setState] = useState<{ busy: boolean; error: string | null; name: string | null; over: boolean }>({
    busy: false,
    error: null,
    name: null,
    over: false,
  });

  async function upload(file: File) {
    setState((s) => ({ ...s, busy: true, error: null, name: file.name, over: false }));
    try {
      const prepared = transform ? await transform(file) : { contentType: file.type || "application/octet-stream", base64: await readBase64(file) };
      if (Math.floor((prepared.base64.length * 3) / 4) > MAX_BYTES) throw new Error("That file is over 2 MB. Try a smaller photo.");
      const res = await fetch("/api/blobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepared),
      });
      const body = (await res.json()) as { ref?: string; contentType?: string; error?: string };
      if (!res.ok || !body.ref) throw new Error(body.error ?? `Upload failed (${res.status})`);
      setState((s) => ({ ...s, busy: false }));
      onUploaded({ ref: body.ref, contentType: body.contentType ?? prepared.contentType, base64: prepared.base64 });
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && !disabled) void upload(file);
    else setState((s) => ({ ...s, over: false }));
  }

  return (
    <div className={className}>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          if (!state.over) setState((s) => ({ ...s, over: true }));
        }}
        onDragLeave={() => setState((s) => ({ ...s, over: false }))}
        onDrop={onDrop}
        className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed px-6 py-8 text-center text-sm transition-colors duration-[120ms] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pp-blue ${
          state.over ? "border-pp-blue bg-pp-sky-wash" : "border-edge bg-card hover:border-pp-blue hover:bg-paper active:bg-paper-deep"
        } ${disabled ? "pointer-events-none cursor-not-allowed opacity-55" : ""}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-8 w-8 ${state.over ? "text-pp-blue" : "text-ink-soft"}`} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3h16v-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-base font-semibold text-ink">{state.busy ? `Uploading ${state.name ?? ""}…` : label}</span>
        <span className="text-xs text-ink-faint">Up to 2 MB</span>
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled || state.busy}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">
        {state.error ? <span className="text-stamp-red">{state.error}</span> : state.name && !state.busy ? <span className="text-ink-soft">Uploaded {state.name}</span> : null}
      </p>
    </div>
  );
}

export default FileDrop;
