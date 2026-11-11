import { describe, expect, it, vi } from "vitest";
import type { PayPalRail } from "@/core/contracts";
import { PayPalError } from "@/core/rail/errors";
import type { CashWeatherState, ReminderDraft } from "./types";
import { chooseTone } from "./tone";
import { buildNudgePrompt, draftInputFor, draftKeepsFacts, draftReminder, overdueInvoices, parseReminderSignal, templateDraft } from "./nudges";
import { buildStudioFixtures, INJECTION_NOTE } from "./fixtures";
import { buildNarrativePrompt } from "./narrative";
import { buildPayerProfiles, matchPaidInvoices } from "./payers";
import { AS_OF, fixedRuntime, planned, runSteps } from "./testkit";

describe("tone", () => {
  it("selects tone by payer history", () => {
    expect(chooseTone(6, { paid: 3, onTimeRate: 1 })).toBe("friendly");
    expect(chooseTone(20, { paid: 4, onTimeRate: 0.5 })).toBe("firm");
    expect(chooseTone(38, { paid: 4, onTimeRate: 0 })).toBe("final");
  });

  it("treats unknown history as neutral and 45 days as final for anyone", () => {
    expect(chooseTone(10, null)).toBe("friendly");
    expect(chooseTone(10, { paid: 0, onTimeRate: null })).toBe("friendly");
    expect(chooseTone(16, null)).toBe("firm");
    expect(chooseTone(45, { paid: 9, onTimeRate: 1 })).toBe("final");
    expect(chooseTone(5, { paid: 5, onTimeRate: 0.6 })).toBe("firm");
    expect(chooseTone(30, { paid: 1, onTimeRate: 0 })).toBe("firm");
  });
});

describe("reminder drafts", () => {
  const fx = buildStudioFixtures(AS_OF);
  const payers = buildPayerProfiles(fx.invoices, matchPaidInvoices(fx.invoices, fx.transactions));
  const overdue = overdueInvoices(fx.invoices, payers, AS_OF);

  it("drafts friendly, firm and final for the fixture's three overdue invoices", () => {
    expect(overdue.map((o) => [o.invoice.recipientName, o.daysOverdue, o.tone])).toEqual([
      ["Brightline Media", 38, "final"],
      ["Kestrel Health", 20, "firm"],
      ["Juniper Co-op", 6, "friendly"],
    ]);
  });

  it("keeps payment notes out of every prompt", () => {
    const prompts = overdue.map((o) => buildNudgePrompt(draftInputFor(o, "Ana")));
    const { rt } = fixedRuntime();
    return planned(rt, undefined, false).then((state) => {
      prompts.push(buildNarrativePrompt(state.forecast!));
      for (const p of prompts) {
        expect(p).not.toContain("ignore prior instructions");
        expect(p).not.toContain(INJECTION_NOTE);
      }
      // The client whose note carries the injection still gets a reminder.
      expect(overdue.some((o) => o.invoice.recipientName === "Kestrel Health")).toBe(true);
    });
  });

  it("replaces a model draft that drops the amount with the template", async () => {
    const { rt } = fixedRuntime();
    const o = overdue[1];
    vi.spyOn(rt.ai, "json").mockResolvedValueOnce({ subject: "Pay up", note: `Invoice ${o.invoice.number} is late, please pay $3,200.` });
    const d = await draftReminder(rt.ai, o, "Ana");
    const expected = templateDraft(draftInputFor(o, "Ana"));
    expect(d.templated).toBe(true);
    expect(d.note).toBe(expected.note);
    expect(draftKeepsFacts(d, draftInputFor(o, "Ana"))).toBe(true);
    expect(d.note).toContain("$3,200.00");
  });
});

describe("reminder signal", () => {
  const drafts = [{ invoiceId: "a", subject: "s", note: "n" }, { invoiceId: "b", subject: "s", note: "n" }] as ReminderDraft[];

  it("accepts per-invoice decisions and defaults the rest to skip", () => {
    const r = parseReminderSignal({ decisions: [{ invoiceId: "a", action: "edit", subject: "New", note: "Body" }, { invoiceId: "zzz", action: "approve" }] }, drafts);
    expect(r).toEqual({
      ok: true,
      rejected: ["zzz"],
      decisions: [
        { invoiceId: "a", action: "edit", subject: "New", note: "Body" },
        { invoiceId: "b", action: "skip", subject: "s", note: "n" },
      ],
    });
  });

  it("maps the generic approve/decline signal and rejects bad input", () => {
    const all = parseReminderSignal({ approved: true }, drafts);
    expect(all.ok && all.decisions.map((d) => d.action)).toEqual(["approve", "approve"]);
    expect(parseReminderSignal({ decisions: [{ invoiceId: "a", action: "edit", subject: "x", note: "y".repeat(1001) }] }, drafts).ok).toBe(false);
    expect(parseReminderSignal({ decisions: [{ invoiceId: "a", action: "edit" }] }, drafts).ok).toBe(false);
    expect(parseReminderSignal("send them all", drafts).ok).toBe(false);
  });
});

describe("nudges and send_nudges steps", () => {
  async function waiting() {
    const { rt } = fixedRuntime();
    const state = await planned(rt);
    const { state: s, result } = await runSteps(rt, state, ["nudges"]);
    expect("wait" in result && result.resumeAt).toBe("send_nudges");
    return { rt, state: s };
  }
  const reminders = (rt: Awaited<ReturnType<typeof waiting>>["rt"]) => rt.mockRail.calls().filter((c) => c.method === "sendInvoiceReminder");

  it("sends what Ana approves or edits and records every decision", async () => {
    const { rt, state } = await waiting();
    const [final, firm, friendly] = state.drafts;
    const signal = {
      decisions: [
        { invoiceId: friendly.invoiceId, action: "approve" },
        { invoiceId: firm.invoiceId, action: "edit", subject: "Invoice reminder", note: `Hi, ${firm.number} for $3,200.00 is overdue. Ana` },
        { invoiceId: final.invoiceId, action: "skip" },
      ],
    };
    const { state: after, result } = await runSteps(rt, state, ["send_nudges"], signal);
    expect("next" in result && result.next).toBe("confirm_slip");
    const calls = reminders(rt);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.args[0] === firm.invoiceId)?.args[1]).toEqual({ subject: "Invoice reminder", note: `Hi, ${firm.number} for $3,200.00 is overdue. Ana` });
    expect(after.reminders.map((r) => [r.number, r.decision, r.status])).toEqual([
      [final.number, "skip", "skipped"],
      [firm.number, "edit", "sent"],
      [friendly.number, "approve", "sent"],
    ]);
    const events = rt.store.ledger.list(state.slipId!);
    expect(events.filter((e) => e.type === "rail.invoice_reminder").map((e) => (e.data as { decision: string }).decision).sort()).toEqual(["approve", "edit"]);
    expect(events.filter((e) => e.type === "cash-weather.nudge_skipped")).toHaveLength(1);
    expect(events.filter((e) => e.type === "cash-weather.nudge_drafted")).toHaveLength(3);
  });

  it("ignores a decision for an invoice that was not drafted", async () => {
    const { rt, state } = await waiting();
    await runSteps(rt, state, ["send_nudges"], { decisions: [{ invoiceId: "INV2-FORGED-0001", action: "approve" }] });
    expect(reminders(rt)).toHaveLength(0);
    expect(rt.store.ledger.list(state.slipId!).some((e) => e.type === "cash-weather.signal_rejected")).toBe(true);
  });

  it("waits again on a malformed signal and sends nothing", async () => {
    const { rt, state } = await waiting();
    const { result } = await runSteps(rt, state, ["send_nudges"], { decisions: [{ invoiceId: state.drafts[0].invoiceId, action: "edit", subject: "x", note: "y".repeat(1001) }] });
    expect("wait" in result && result.resumeAt).toBe("send_nudges");
    expect("wait" in result && result.wait.message).toMatch(/Nothing was sent/);
    expect(reminders(rt)).toHaveLength(0);
  });

  it("records a PayPal error on one reminder and still sends the others", async () => {
    const { rt, state } = await waiting();
    const real = rt.rail.sendInvoiceReminder.bind(rt.rail);
    vi.spyOn(rt.rail, "sendInvoiceReminder").mockImplementation(async (id, input) => {
      if (id === state.drafts[0].invoiceId) {
        throw new PayPalError({ name: "UNPROCESSABLE_ENTITY", message: "Reminder refused", status: 422, debug_id: "x", details: [{ issue: "INVALID_INVOICE_STATUS" }] });
      }
      return real(id, input);
    });
    const { state: after } = await runSteps(rt, state, ["send_nudges"], { approved: true });
    expect(after.reminders.map((r) => r.status)).toEqual(["failed", "sent", "sent"]);
    expect(rt.store.ledger.list(state.slipId!).filter((e) => e.type === "cash-weather.nudge_failed")).toHaveLength(1);
  });

  it("records reminders for sample invoices in sandbox fallback without calling PayPal", async () => {
    const { rt, state } = await waiting();
    const fixtureState: CashWeatherState = { ...state, drafts: state.drafts.map((d) => ({ ...d, source: "fixture" })) };
    const spy = vi.spyOn(rt.rail as PayPalRail, "sendInvoiceReminder");
    const { state: after } = await runSteps(rt, fixtureState, ["send_nudges"], { approved: true });
    expect(spy).not.toHaveBeenCalled();
    expect(after.reminders.every((r) => r.status === "simulated")).toBe(true);
  });

  it("skips the wait when nothing is overdue", async () => {
    const { rt } = fixedRuntime();
    const state = await planned(rt);
    const { result } = await runSteps(rt, { ...state, invoices: state.invoices.filter((i) => i.status === "PAID") }, ["nudges"]);
    expect("next" in result && result.next).toBe("confirm_slip");
  });
});
