/**
 * Builders for core tests. Pipelines should prefer createTestRuntime() from "@/core/testing";
 * these helpers avoid importing the pipeline registry so core tests do not depend on pipeline code.
 */
import type {
  Clause,
  ExtractedFacts,
  NewProposal,
  NewSlip,
  PipelineDefinition,
  PipelineId,
  Proposal,
  ProposalItem,
  Slip,
} from "./contracts";
import { createMockAI } from "./ai/mock";
import { createMockRail } from "./rail/mock";
import { buildRuntime } from "./runtime-factory";
import { createSqliteStore } from "./store/sqlite";
import { money } from "./money";

export function facts(overrides: Partial<ExtractedFacts> = {}): ExtractedFacts {
  return {
    category: "toys",
    inStock: true,
    deliveryEstimate: "2026-11-20",
    itemCount: 1,
    attributes: { power_source: "none" },
    injectionSuspected: false,
    ...overrides,
  };
}

export function item(overrides: Partial<ProposalItem> = {}): ProposalItem {
  return {
    title: "Wooden train set",
    quantity: 1,
    unitPrice: money("30.00"),
    facts: facts(),
    sourceUrl: null,
    ...overrides,
  };
}

export function slipFixture(clauses: Clause[], overrides: Partial<Slip> = {}): Slip {
  return {
    id: "slip_test",
    pipeline: "shop",
    parentId: null,
    principal: { name: "Ada", email: "ada@example.com" },
    intent: "a toy under $50",
    clauses,
    budget: money("50.00"),
    spent: money("0.00"),
    status: "active",
    rail: { orderId: null, authorizationId: null, approveUrl: null, captureIds: [], refundIds: [], payoutBatchIds: [] },
    createdAt: "2026-11-08T00:00:00.000Z",
    expiresAt: "2026-11-11T00:00:00.000Z",
    meta: {},
    ...overrides,
  };
}

export function proposalFixture(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop_test",
    slipId: "slip_test",
    kind: "purchase",
    amount: money("30.00"),
    payee: null,
    items: [item()],
    evidence: [],
    rationale: "fits the slip",
    createdAt: "2026-11-08T00:00:00.000Z",
    ...overrides,
  };
}

export function newProposal(overrides: Partial<NewProposal> = {}): NewProposal {
  const p = proposalFixture();
  return { slipId: p.slipId, kind: p.kind, amount: p.amount, payee: p.payee, items: p.items, evidence: p.evidence, rationale: p.rationale, ...overrides };
}

export const BUDGET_50: Extract<Clause, { kind: "budget_max" }> = { id: "c1", kind: "budget_max", label: "Spend at most $50", amount: money("50.00") };

export function newSlipInput(overrides: Partial<NewSlip> = {}): NewSlip {
  return {
    pipeline: "shop",
    principal: { name: "Ada", email: "ada@example.com" },
    intent: "a toy under $50",
    clauses: [BUDGET_50],
    budget: money("50.00"),
    expiresAt: "2026-11-11T00:00:00.000Z",
    ...overrides,
  };
}

export function coreRuntime(
  opts: { now?: () => Date; pipelines?: Partial<Record<PipelineId, PipelineDefinition>> } = {},
) {
  const now = opts.now ?? (() => new Date("2026-11-08T12:00:00.000Z"));
  const store = createSqliteStore(":memory:", { now });
  const mockRail = createMockRail({ baseUrl: "http://localhost:3000", now });
  const runtime = buildRuntime({ store, rail: mockRail, ai: createMockAI(), pipelines: opts.pipelines ?? {}, baseUrl: "http://localhost:3000", now });
  return Object.assign(runtime, { mockRail, store });
}
