"use client";
import { useId, useRef, useState } from "react";
import { FileDrop } from "@/components/file-drop";
import { DUPLICATE_PAIR, FIXTURES, PASSING_PAIR, SECOND_PASSING_PAIR, type FixtureName } from "@/pipelines/bounty/fixtures";
import type { ProofPhoto } from "@/pipelines/bounty/schema";
import { captureTime, currentPosition, isoFromNow, prepareImage, uploadBlob } from "./image-tools";

type Role = "before" | "after";

interface Shot {
  photo: ProofPhoto;
  preview: string;
}

export interface ProofCaptureProps {
  shots: { before: string; after: string };
  disabled?: boolean;
  onSubmit: (proof: { before: ProofPhoto; after: ProofPhoto }) => Promise<void>;
}

const SAMPLES: { label: string; pair: [FixtureName, FixtureName] }[] = [
  { label: "Sample drain photos", pair: PASSING_PAIR },
  { label: "Sample walk photos", pair: SECOND_PASSING_PAIR },
  { label: "A reused photo (should fail)", pair: DUPLICATE_PAIR },
];

function PhotoSlot({ role, hint, shot, busy, onFile, onDropped }: {
  role: Role;
  hint: string;
  shot: Shot | null;
  busy: boolean;
  onFile: (file: File) => void;
  onDropped: (shot: Shot) => void;
}) {
  const id = useId();
  // Set in transform, read in onUploaded during the same upload; a ref avoids a stale closure.
  const dropMeta = useRef<{ dHash: string; capturedAt: string } | null>(null);
  return (
    <div className="min-w-0 rounded-md bg-paper-deep p-3 sm:p-4">
      <p className="text-base font-semibold capitalize text-ink">{role} photo</p>
      <p className="mt-1 text-xs text-ink-soft">{hint}</p>
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.preview} alt={`${role} photo preview`} className="mt-3 aspect-[4/3] w-full rounded-sm object-cover" />
      ) : (
        <div aria-hidden="true" className="mt-3 flex aspect-[4/3] w-full items-center justify-center rounded-sm bg-card text-edge">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8.5A1.5 1.5 0 015.5 7h2.2l1.2-2h6.2l1.2 2h2.2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
        </div>
      )}
      <label
        htmlFor={id}
        className={`mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-pill border border-edge bg-card px-5 py-2 text-center text-sm font-semibold text-ink transition-colors duration-[120ms] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pp-blue hover:border-ink active:bg-paper-deep ${busy ? "pointer-events-none cursor-not-allowed opacity-55" : ""}`}
      >
        {shot ? `Retake ${role} photo` : `Take ${role} photo`}
        <input
          id={id}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </label>
      <details className="mt-3 text-sm text-ink-soft">
        <summary className="cursor-pointer font-semibold text-pp-blue underline decoration-line underline-offset-4 hover:decoration-pp-blue">On a laptop? Drop a photo file instead</summary>
        <FileDrop
          className="mt-2"
          accept="image/*"
          disabled={busy}
          label={`Drop the ${role} photo`}
          transform={async (file) => {
            const prepared = await prepareImage(file);
            dropMeta.current = { dHash: prepared.dHash, capturedAt: captureTime(file) };
            return { contentType: prepared.contentType, base64: prepared.base64 };
          }}
          onUploaded={(f) => {
            const meta = dropMeta.current;
            if (!meta) return;
            onDropped({
              photo: { blobRef: f.ref, capturedAt: meta.capturedAt, dHash: meta.dHash },
              preview: `data:${f.contentType};base64,${f.base64}`,
            });
          }}
        />
      </details>
    </div>
  );
}

/** Before and after capture with the rear camera, dHash in the browser, upload to /api/blobs. */
export function ProofCapture({ shots, disabled = false, onSubmit }: ProofCaptureProps) {
  const [photos, setPhotos] = useState<Record<Role, Shot | null>>({ before: null, after: null });
  const [busy, setBusy] = useState(false);
  const [withLocation, setWithLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function take(role: Role, file: File) {
    setBusy(true);
    setError(null);
    try {
      // lastModified is the capture time for camera shots; a gallery pick keeps its older time.
      const capturedAt = captureTime(file);
      const prepared = await prepareImage(file);
      const blobRef = await uploadBlob(prepared);
      setPhotos((p) => ({
        ...p,
        [role]: { photo: { blobRef, capturedAt, dHash: prepared.dHash }, preview: `data:image/jpeg;base64,${prepared.base64}` },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applySample(pair: [FixtureName, FixtureName]) {
    setBusy(true);
    setError(null);
    try {
      const next: Record<Role, Shot> = { before: null as unknown as Shot, after: null as unknown as Shot };
      for (const [i, role] of (["before", "after"] as Role[]).entries()) {
        const f = FIXTURES[pair[i]];
        const blobRef = await uploadBlob({ contentType: f.contentType, base64: f.base64 });
        next[role] = {
          photo: { blobRef, dHash: f.dHash, capturedAt: isoFromNow(-(1 - i) * 1000) },
          preview: `data:${f.contentType};base64,${f.base64}`,
        };
      }
      setPhotos(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!photos.before || !photos.after) return;
    setBusy(true);
    setError(null);
    try {
      let before = photos.before.photo;
      let after = photos.after.photo;
      if (withLocation) {
        const at = await currentPosition();
        before = { ...before, ...at };
        after = { ...after, ...at };
      }
      await onSubmit({ before, after });
      setPhotos({ before: null, after: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const off = busy || disabled;
  return (
    <section aria-label="Proof photos" className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {(["before", "after"] as Role[]).map((role) => (
          <PhotoSlot
            key={role}
            role={role}
            hint={shots[role]}
            shot={photos[role]}
            busy={off}
            onFile={(file) => void take(role, file)}
            onDropped={(shot) => setPhotos((p) => ({ ...p, [role]: shot }))}
          />
        ))}
      </div>
      <label className="flex items-center gap-3 text-sm text-ink-soft">
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-pp-blue disabled:cursor-not-allowed" checked={withLocation} onChange={(e) => setWithLocation(e.target.checked)} disabled={off} />
        Attach my location to both photos (checked against the job site)
      </label>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={off || !photos.before || !photos.after}
          className="inline-flex h-11 items-center justify-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? "Working…" : "Send proof for checking"}
        </button>
        <details className="text-sm text-ink-soft">
          <summary className="cursor-pointer font-semibold text-pp-blue underline decoration-line underline-offset-4 hover:decoration-pp-blue">No camera? Use sample photos</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={off}
                onClick={() => void applySample(s.pair)}
                className="min-h-11 rounded-pill border border-edge bg-card px-4 py-2 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55"
              >
                {s.label}
              </button>
            ))}
          </div>
        </details>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-stamp-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default ProofCapture;
