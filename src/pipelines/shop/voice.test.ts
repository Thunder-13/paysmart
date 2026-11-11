import { describe, expect, it } from "vitest";
import type { Verdict } from "@/core/contracts";
import { money } from "@/core/money";
import { normalizeCompiledSlip } from "@/core/services";
import { mockCompile } from "./compile";
import { DEMO_INTENT } from "./types";
import { cartUtterance, detectSpeechSupport, matchVoiceCommand, optionsUtterances, parseVoiceCommand, slipUtterances, speakMoney, speakText, verdictUtterance } from "./voice";

const NOW = new Date("2026-11-08T18:00:00.000Z");
const slip = normalizeCompiledSlip(mockCompile(DEMO_INTENT, NOW), NOW);

describe("voice command matching", () => {
  it.each([
    ["yes, approve cart", "approve_cart"],
    ["Approve the cart.", "approve_cart"],
    ["confirm cart please", "approve_cart"],
    ["cancel the cart", "reject_cart"],
    ["Reject cart!", "reject_cart"],
  ])("%s -> %s", (said, cmd) => {
    expect(matchVoiceCommand(said)).toBe(cmd);
  });

  it.each(["don't approve the cart", "Do not approve cart", "never confirm the cart", "approve", "approve or cancel the cart", "what's in the cart"])(
    "%s -> nothing",
    (said) => {
      expect(matchVoiceCommand(said)).toBeNull();
    },
  );

  it("handles curly apostrophes", () => {
    expect(matchVoiceCommand("don’t approve the cart")).toBeNull();
  });
});

describe("choosing an option by voice", () => {
  it.each([
    ["option two", 2],
    ["option 2", 2],
    ["pick option 2", 2],
    ["choose the second option", 2],
    ["Choose the first option.", 1],
    ["I'll take the third option", 3],
    ["pick option three", 3],
    ["option 1", 1],
  ])("%s -> option %i", (said, index) => {
    expect(parseVoiceCommand(said)).toEqual({ kind: "choose_option", index });
  });

  it.each(["option 4", "option 0", "don't pick option 2", "do not choose the second option", "never option 1", "option 1 or option 2", "approve cart option 2", "pick an option", "what is option"])(
    "%s -> nothing",
    (said) => {
      expect(parseVoiceCommand(said)).toBeNull();
    },
  );

  it("keeps the cart verbs as they were", () => {
    expect(parseVoiceCommand("approve the cart")).toEqual({ kind: "approve_cart" });
    expect(parseVoiceCommand("cancel cart")).toEqual({ kind: "reject_cart" });
    expect(parseVoiceCommand("don't approve the cart")).toBeNull();
    expect(parseVoiceCommand("approve")).toBeNull();
  });

  it("reads the options aloud only when there is a choice", () => {
    const opt = (rank: number, title: string, amount: string) => ({
      rank,
      lines: [{ title, quantity: 1 }],
      proposal: { amount: money(amount) },
      verdict: { decision: "within" as const },
    });
    expect(optionsUtterances([opt(1, "Rex", "42.18")])).toEqual([]);
    const lines = optionsUtterances([opt(1, "Rex", "42.18"), opt(2, "Dig kit", "21.40")]);
    expect(lines[0]).toMatch(/2 carts passed the guard/);
    expect(lines[2]).toBe("Option 2: Dig kit, 21 dollars and 40 cents. Within the slip.");
  });
});

describe("utterances", () => {
  it("speaks money", () => {
    expect(speakMoney(money("42.18"))).toBe("42 dollars and 18 cents");
    expect(speakMoney(money("60.00"))).toBe("60 dollars");
    expect(speakMoney(money("0.05"))).toBe("5 cents");
    expect(speakMoney(money("1.01"))).toBe("1 dollar and 1 cent");
    expect(speakText("Spend at most $60.00")).toBe("Spend at most 60 dollars");
  });

  it("reads the slip as a summary plus one line per clause", () => {
    const lines = slipUtterances(slip.summary, slip.clauses);
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe("Clause 1: Spend at most 60 dollars.");
    expect(lines[2]).toBe("Clause 2: One gift.");
  });

  it("reads an OUTSIDE verdict with clause labels and integrity", () => {
    const verdict: Pick<Verdict, "decision" | "violations" | "unknowns"> = {
      decision: "outside",
      violations: [
        { clauseId: "integrity", message: "x" },
        { clauseId: "c2", message: "x" },
        { clauseId: "c1", message: "x" },
        { clauseId: "c2", message: "y" },
      ],
      unknowns: [],
    };
    const text = verdictUtterance(verdict, slip.clauses);
    expect(text).toBe(
      "Outside the slip. Clause 1: Spend at most 60 dollars. Clause 2: One gift. Integrity: the listing tried to give the agent orders.",
    );
    expect(verdictUtterance({ decision: "within", violations: [], unknowns: [] }, slip.clauses)).toBe("Within the slip.");
  });

  it("reads the cart and how to approve it", () => {
    const text = cartUtterance([{ title: "Clockwork Rex", quantity: 1 }], { capture: money("42.18"), release: money("17.82") });
    expect(text).toContain("Capturing 42 dollars and 18 cents and releasing 17 dollars and 82 cents");
    expect(text).toContain("Say approve cart");
  });
});

describe("speech support detection", () => {
  it("reports missing APIs as unsupported", () => {
    expect(detectSpeechSupport(undefined)).toEqual({ recognition: false, synthesis: false });
    expect(detectSpeechSupport({})).toEqual({ recognition: false, synthesis: false });
  });

  it("finds the prefixed recognizer and synthesis", () => {
    function Rec() {}
    function Utter() {}
    expect(detectSpeechSupport({ webkitSpeechRecognition: Rec, speechSynthesis: { speak() {} }, SpeechSynthesisUtterance: Utter })).toEqual({
      recognition: true,
      synthesis: true,
    });
  });
});
