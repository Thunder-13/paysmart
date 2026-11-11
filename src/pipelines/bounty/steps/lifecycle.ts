/**
 * Bounty run, first half: route, draft, funding, claim, verify.
 */
import { createHash } from "node:crypto";
import type { Clause, EvidenceRef, ImageInput } from "@/core/contracts";
import { cmpMoney, formatMoney, money } from "@/core/money";
import { newId } from "@/core/ids";
import { draftBounty, verifyProof } from "../ai";
import { freshPhotos, location, timing, type CheckedPhoto } from "../checks";
import { bounties, bountyEvent, fundedTotal, mustBounty, pledgeSlips, proofs, saveBounty, setSlipStatus } from "../records";
import {
  CLOCK_SKEW_MS,
  DEADLINE_MAX_MS,
  DEADLINE_MIN_MS,
  REWARD_MAX,
  REWARD_MIN,
  parseBountySignal,
  type Bounty,
  type CheckResult,
  type ProofPhoto,
  type ProofRow,
} from "../schema";
import { baseClauses, closeIfDue, waitForClaim, waitForPledges, waitForProof, type Ctx, type Step } from "./shared";

const IMAGE_TYPES: ImageInput["mediaType"][] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const route: Step = async (ctx) => ({ next: ctx.run.state.kind === "pledge" ? "pledge_start" : "draft" });

function bountyFor(ctx: Ctx): Bounty {
  const id = ctx.run.state.bountyId;
  if (!id) throw new Error("This run has no bounty yet.");
  return mustBounty(ctx.store, id);
}

/* --------------------------------------------------------------- draft */

export const draft: Step = async (ctx) => {
  const input = ctx.run.state.bounty;
  if (!input) return { fail: "This run has no bounty input." };
  const now = ctx.now();
  if (input.reward.currency.toUpperCase() !== "USD") return { fail: "reward: only USD bounties are supported." };
  if (cmpMoney(input.reward, money(REWARD_MIN)) < 0 || cmpMoney(input.reward, money(REWARD_MAX)) > 0) {
    return { fail: `reward: must be between ${formatMoney(money(REWARD_MIN))} and ${formatMoney(money(REWARD_MAX))}, got ${formatMoney(input.reward)}.` };
  }
  const deadlineMs = Date.parse(input.deadline);
  if (Number.isNaN(deadlineMs) || deadlineMs < now.getTime() + DEADLINE_MIN_MS) {
    return { fail: "deadline: must be at least 1 hour from now." };
  }
  if (deadlineMs > now.getTime() + DEADLINE_MAX_MS + CLOCK_SKEW_MS) {
    return { fail: "deadline: must be within 72 hours, so every PayPal hold stays inside its 3-day honor period." };
  }
  const deadline = new Date(deadlineMs).toISOString();

  const drafted = await draftBounty(ctx.ai, { title: input.title, description: input.description });
  const bountyId = newId("bounty");
  const slip = ctx.core.createSlip({
    pipeline: "bounty",
    principal: { name: `Bounty pool: ${input.title}`, email: null },
    intent: input.description,
    clauses: baseClauses({ amount: input.reward, rubric: drafted.rubric, deadline, who: "pool" }),
    budget: input.reward,
    expiresAt: deadline,
    meta: { role: "payout", bountyId, organizer: input.organizer },
  });
  const at = now.toISOString();
  const bounty: Bounty = {
    id: bountyId,
    runId: ctx.run.id,
    payoutSlipId: slip.id,
    title: input.title,
    description: input.description,
    reward: input.reward,
    deadline,
    location: input.location,
    organizer: input.organizer,
    rubric: drafted.rubric,
    checks: drafted.checks,
    shots: drafted.shots,
    status: "funding",
    claim: null,
    attempts: [],
    evidence: null,
    captures: [],
    payout: null,
    failure: null,
    createdAt: at,
    updatedAt: at,
  };
  bounties(ctx.store).put(bounty.id, bounty);
  bountyEvent(ctx.store, slip.id, "bounty.created", "user", {
    message: `${input.organizer.name} posted "${bounty.title}" for ${formatMoney(bounty.reward)}, with ${bounty.checks.length} photo checks.`,
    bountyId,
    title: bounty.title,
    reward: bounty.reward,
    deadline,
    rubric: bounty.rubric,
    checks: bounty.checks,
    organizer: bounty.organizer.name,
  });
  return { ...waitForPledges(bounty, money(0, input.reward.currency), null), slipId: slip.id, state: { bountyId, payoutSlipId: slip.id, lastRejection: null } };
};

/* ------------------------------------------------------------- funding */

export const funding: Step = async (ctx) => {
  const bounty = bountyFor(ctx);
  const parsed = parseBountySignal(ctx.signal);
  const closing = closeIfDue(ctx, bounty, parsed);
  if (closing) return closing;

  let rejection: string | null | undefined;
  if (!parsed.ok) rejection = parsed.reason;
  else if (parsed.signal.event === "claim") rejection = "Claims open once backers cover the whole reward.";
  else if (parsed.signal.event === "proof") rejection = "Proof comes after someone claims the job.";
  else if (parsed.signal.event === "payout_retry" || parsed.signal.event === "payout_refund") rejection = "There is no payout to retry or refund yet.";
  else if (parsed.signal.event === "pledge") rejection = null;

  const funded = fundedTotal(ctx.store, bounty);
  if (cmpMoney(funded, bounty.reward) < 0) return waitForPledges(bounty, funded, rejection);

  const slip = ctx.store.slips.get(bounty.payoutSlipId);
  if (slip) setSlipStatus(ctx.store, slip, "active", `Backers hold ${formatMoney(funded)}, which covers the reward.`);
  const saved = saveBounty(ctx.store, bounty, { status: "funded" }, ctx.now());
  const held = pledgeSlips(ctx.store, bounty.id).filter((s) => s.status === "active");
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.funded", "system", {
    message: `${held.length} backer${held.length === 1 ? "" : "s"} hold ${formatMoney(funded)}; the reward is covered and the job is open to claim.`,
    funded,
    reward: bounty.reward,
    pledges: held.map((s) => ({ slipId: s.id, backer: s.principal.name, amount: s.budget })),
  });
  return waitForClaim(saved, rejection ?? null);
};

/* --------------------------------------------------------------- claim */

export const claim: Step = async (ctx) => {
  const bounty = bountyFor(ctx);
  const parsed = parseBountySignal(ctx.signal);
  const closing = closeIfDue(ctx, bounty, parsed);
  if (closing) return closing;
  if (!parsed.ok) return waitForClaim(bounty, parsed.reason);
  const signal = parsed.signal;
  if (signal.event === "pledge") return waitForClaim(bounty, "This bounty is fully funded; it needs no more pledges.");
  if (signal.event === "proof") return waitForClaim(bounty, "Claim the job before sending proof.");
  if (signal.event !== "claim") return waitForClaim(bounty, undefined);

  const slip = ctx.store.slips.get(bounty.payoutSlipId);
  if (!slip) return { fail: `Payout slip ${bounty.payoutSlipId} is missing.` };
  const email = signal.workerEmail.trim().toLowerCase();
  const clause: Clause = {
    id: `c${slip.clauses.length + 1}`,
    kind: "payee_allowlist",
    label: `Pays only ${signal.workerName} (${email})`,
    payees: [email],
  };
  // Clauses only ever narrow: the existing ones stay as they are.
  ctx.store.slips.update(slip.id, { clauses: [...slip.clauses, clause] });
  const saved = saveBounty(
    ctx.store,
    bounty,
    { status: "claimed", claim: { workerName: signal.workerName, workerEmail: email, claimedAt: ctx.now().toISOString() } },
    ctx.now(),
  );
  bountyEvent(ctx.store, slip.id, "bounty.claimed", "user", {
    message: `${signal.workerName} claimed the job; clause ${clause.id} now pays only ${email}.`,
    workerName: signal.workerName,
    workerEmail: email,
    clause,
  });
  return waitForProof(saved, null);
};

/* -------------------------------------------------------------- verify */

function sha256(base64: string): string {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

interface LoadedPhoto {
  photo: ProofPhoto;
  image: ImageInput;
  sha256: string;
}

function loadPhoto(ctx: Ctx, role: "before" | "after", photo: ProofPhoto): LoadedPhoto | string {
  const blob = ctx.store.blobs.get(photo.blobRef);
  if (!blob) return `The ${role} photo was never uploaded (blob ${photo.blobRef} not found).`;
  const mediaType = blob.contentType.toLowerCase() as ImageInput["mediaType"];
  if (!IMAGE_TYPES.includes(mediaType)) return `The ${role} photo is ${blob.contentType}, not an image.`;
  return { photo, image: { mediaType, base64: blob.base64 }, sha256: sha256(blob.base64) };
}

export const verify: Step = async (ctx) => {
  const bounty = bountyFor(ctx);
  const parsed = parseBountySignal(ctx.signal);
  const closing = closeIfDue(ctx, bounty, parsed);
  if (closing) return closing;
  if (!parsed.ok) return waitForProof(bounty, parsed.reason);
  const signal = parsed.signal;
  if (signal.event === "claim") return waitForProof(bounty, `Already claimed by ${bounty.claim?.workerName ?? "someone else"}.`);
  if (signal.event === "pledge") return waitForProof(bounty, "This bounty is fully funded; it needs no more pledges.");
  if (signal.event !== "proof") return waitForProof(bounty, undefined);
  if (!bounty.claim) return { fail: "Proof arrived for a bounty nobody claimed." };

  const before = loadPhoto(ctx, "before", signal.before);
  const after = loadPhoto(ctx, "after", signal.after);
  if (typeof before === "string") return waitForProof(bounty, before);
  if (typeof after === "string") return waitForProof(bounty, after);

  const now = ctx.now();
  const photos: [CheckedPhoto, CheckedPhoto] = [
    { role: "before", dHash: before.photo.dHash, sha256: before.sha256, capturedAt: before.photo.capturedAt, lat: before.photo.lat, lng: before.photo.lng },
    { role: "after", dHash: after.photo.dHash, sha256: after.sha256, capturedAt: after.photo.capturedAt, lat: after.photo.lat, lng: after.photo.lng },
  ];
  const store = proofs(ctx.store);
  const deterministic: CheckResult[] = [
    freshPhotos(photos, store.list()),
    timing(photos, bounty.claim.claimedAt, bounty.deadline, now),
    location(photos, bounty.location),
  ];

  // Every submitted photo is kept, pass or fail, so it can never be sent again.
  const attemptNo = bounty.attempts.length + 1;
  const rows: ProofRow[] = [before, after].map((p, i) => ({
    id: newId("proof"),
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    role: i === 0 ? "before" : "after",
    blobRef: p.photo.blobRef,
    sha256: p.sha256,
    dHash: p.photo.dHash,
    capturedAt: p.photo.capturedAt,
    lat: p.photo.lat ?? null,
    lng: p.photo.lng ?? null,
    submittedAt: now.toISOString(),
    passed: false,
  }));
  for (const row of rows) store.put(row.id, row);
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.proof_submitted", "user", {
    message: `Proof attempt ${attemptNo}: before and after photos sent.`,
    attempt: attemptNo,
    before: { blobRef: before.photo.blobRef, dHash: before.photo.dHash, sha256: before.sha256, capturedAt: before.photo.capturedAt },
    after: { blobRef: after.photo.blobRef, dHash: after.photo.dHash, sha256: after.sha256, capturedAt: after.photo.capturedAt },
  });

  let results: CheckResult[];
  let pass: boolean;
  if (deterministic.some((r) => r.status === "fail")) {
    pass = false;
    results = [
      ...deterministic,
      ...bounty.checks.map((c) => ({
        ...c,
        status: "skipped" as const,
        detail: "Not run: a check above failed, so the photos never reached the inspector.",
      })),
    ];
  } else {
    const graded = await verifyProof(ctx.ai, {
      title: bounty.title,
      rubric: bounty.rubric,
      checks: bounty.checks,
      before: before.image,
      after: after.image,
    });
    pass = graded.pass;
    results = [...deterministic, ...graded.results];
  }
  const attempt = { at: now.toISOString(), pass, results, beforeRef: before.photo.blobRef, afterRef: after.photo.blobRef };

  if (!pass) {
    const saved = saveBounty(ctx.store, bounty, { attempts: [...bounty.attempts, attempt] }, now);
    const failed = results.filter((r) => r.status === "fail");
    bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.rejected", "agent", {
      message: `Proof attempt ${attemptNo} rejected: ${failed.map((r) => r.label).join("; ") || "a check failed"}.`,
      attempt: attemptNo,
      failed: failed.map((r) => ({ id: r.id, detail: r.detail })),
    });
    const first = failed[0];
    return waitForProof(saved, `Proof rejected: ${first ? `${first.label}. ${first.detail}` : "a check failed."} Take new photos and try again.`);
  }

  const rubricPassed = results.filter((r) => bounty.checks.some((c) => c.id === r.id) && r.status === "pass").length;
  const evidence: EvidenceRef = {
    kind: "before_after_photos",
    verdict: "pass",
    detail: `${rubricPassed} of ${bounty.checks.length} rubric checks passed; photos are fresh and taken between the claim and the deadline.`,
    ref: `${before.photo.blobRef},${after.photo.blobRef}`,
  };
  ctx.core.addEvidence(bounty.payoutSlipId, evidence);
  for (const slip of pledgeSlips(ctx.store, bounty.id)) {
    if (slip.status === "active") ctx.core.addEvidence(slip.id, evidence);
  }
  for (const row of rows) store.put(row.id, { ...row, passed: true });
  saveBounty(ctx.store, bounty, { status: "verified", attempts: [...bounty.attempts, attempt], evidence }, now);
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.verified", "agent", { message: `Proof attempt ${attemptNo} passed: ${evidence.detail}`, attempt: attemptNo, evidence });
  return { next: "settle", state: { lastRejection: null } };
};
