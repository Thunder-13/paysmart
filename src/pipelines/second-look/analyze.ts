/**
 * Scam analysis (D2 to D5): one no-tool ai.json call, deterministic detectors, quote check, union,
 * score floor, band and card. Pure apart from the injected AI and blob store, so tests can swap in
 * a hijacked model.
 */
import type { AI, BlobStore, ImageInput } from "@/core/contracts";
import { detectInjection } from "@/core/extractor";
import { detect, detectorFloor } from "./detectors";
import { mockAnalysis } from "./mock";
import { deterministicCard } from "./offer";
import { ANALYZE_LABEL, SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { MAX_IMAGE_BYTES, TACTIC_LABELS, bandOf, type TacticId } from "./taxonomy";
import { quoteFound } from "./text";
import { ModelAnalysisSchema, type Analysis, type SecondLookInput, type Tactic } from "./types";

const IMAGE_TYPES: ImageInput["mediaType"][] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const NOTE_INJECTION = "AI-directed text found: part of this conversation tries to give instructions to an AI. We read it as data and ignored it.";
export const NOTE_SCREENSHOT_SKIPPED = "The screenshot could not be read (missing, too large, or not an image), so only the typed text was checked.";
export const NOTE_MOCK_SCREENSHOT = "Demo mode: the screenshot reading is scripted, not read from the image.";

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s+/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

/** Loads the screenshot as an ImageInput, or null when it is missing, too big or not an image. */
export function loadScreenshot(blobs: BlobStore, ref: string | undefined): { image: ImageInput | null; skipped: boolean } {
  if (!ref) return { image: null, skipped: false };
  const blob = blobs.get(ref);
  if (!blob) return { image: null, skipped: true };
  const type = blob.contentType.toLowerCase().split(";")[0].trim() as ImageInput["mediaType"];
  if (!IMAGE_TYPES.includes(type) || base64Bytes(blob.base64) > MAX_IMAGE_BYTES) return { image: null, skipped: true };
  return { image: { mediaType: type, base64: blob.base64 }, skipped: false };
}

export async function analyzeConversation(deps: { ai: AI; blobs: BlobStore }, input: SecondLookInput): Promise<Analysis> {
  const notes: string[] = [];
  const shot = loadScreenshot(deps.blobs, input.screenshotRef);
  if (shot.skipped) notes.push(NOTE_SCREENSHOT_SKIPPED);
  const hasImage = shot.image !== null;

  const model = await deps.ai.json({
    label: ANALYZE_LABEL,
    tier: "smart",
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input, { hasImage }),
    schema: ModelAnalysisSchema,
    ...(shot.image ? { images: [shot.image] } : {}),
    mock: () => mockAnalysis({ chatText: input.chatText, listingText: input.listingText, hasImage }),
  });
  if (hasImage && deps.ai.mode === "mock") notes.push(NOTE_MOCK_SCREENSHOT);

  const transcript = hasImage && model.transcript ? clip(model.transcript, 8000) : null;
  const corpus = [input.chatText, transcript, input.listingText];

  // Deterministic findings first: these survive any model output.
  const findings = detect([
    { source: "chat", text: input.chatText },
    { source: "transcript", text: transcript },
    { source: "listing", text: input.listingText },
  ]);
  const floor = detectorFloor(findings);

  const merged = new Map<TacticId, Tactic>();
  for (const f of findings) {
    merged.set(f.id, { id: f.id, label: TACTIC_LABELS[f.id], quote: f.quote, why: "Matched a known scam phrase.", source: "rule" });
  }
  for (const t of model.tactics) {
    // D3: a model tactic needs a quote that really appears in the content.
    if (!quoteFound(t.quote, corpus)) continue;
    const prev = merged.get(t.id);
    if (prev) {
      // The detector quote wins; the model adds its reason. A repeated model id keeps the first.
      if (prev.source === "rule") merged.set(t.id, { ...prev, why: clip(t.why, 200) || prev.why, source: "both" });
    } else {
      merged.set(t.id, { id: t.id, label: TACTIC_LABELS[t.id], quote: clip(t.quote, 300), why: clip(t.why, 200), source: "model" });
    }
  }
  const tactics = [...merged.values()];

  const modelScore = model.riskScore;
  const riskScore = Math.max(modelScore, floor);
  const band = bandOf(riskScore);

  const injectionSuspected = [input.chatText, input.listingText, transcript].some((t) => !!t && detectInjection(t));
  if (injectionSuspected) notes.push(NOTE_INJECTION);

  // The model's words are only shown when they agree with the final band and nothing tried to steer it.
  const trustModelText = !injectionSuspected && bandOf(modelScore) === band && model.headline.trim() !== "" && model.explanation.trim() !== "";
  const card = trustModelText
    ? { headline: clip(model.headline, 120), explanation: clip(model.explanation, 600) }
    : deterministicCard(tactics, band);

  return {
    tactics,
    riskScore,
    modelScore,
    floor,
    band,
    headline: card.headline,
    explanation: card.explanation,
    notes,
    injectionSuspected,
    transcript,
    usedImage: hasImage,
  };
}
