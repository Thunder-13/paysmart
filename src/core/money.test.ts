import { describe, expect, it } from "vitest";
import { addMoney, cmpMoney, formatMoney, fromCents, money, mulMoney, subMoney, sumMoney, toCents } from "./money";

describe("money", () => {
  it("parses strings and numbers into two-decimal wire values", () => {
    expect(money("12")).toEqual({ currency: "USD", value: "12.00" });
    expect(money("12.3")).toEqual({ currency: "USD", value: "12.30" });
    expect(money("$1,250.5")).toEqual({ currency: "USD", value: "1250.50" });
    expect(money(0.1 + 0.2)).toEqual({ currency: "USD", value: "0.30" });
    expect(money(12.345)).toEqual({ currency: "USD", value: "12.35" });
    expect(money("-4.2", "eur")).toEqual({ currency: "EUR", value: "-4.20" });
    expect(() => money("abc")).toThrow();
  });

  it("round-trips cents", () => {
    expect(toCents(money("42.18"))).toBe(4218);
    expect(fromCents(-5, "USD").value).toBe("-0.05");
    expect(fromCents(0).value).toBe("0.00");
  });

  it("adds, subtracts, compares and sums without floats", () => {
    expect(addMoney(money("0.10"), money("0.20")).value).toBe("0.30");
    expect(subMoney(money("10.00"), money("12.50")).value).toBe("-2.50");
    expect(cmpMoney(money("1.00"), money("1.01"))).toBe(-1);
    expect(cmpMoney(money("1.00"), money("1"))).toBe(0);
    expect(cmpMoney(money("2.00"), money("1.99"))).toBe(1);
    expect(sumMoney([money("1.10"), money("2.20"), money("3.30")], "USD").value).toBe("6.60");
    expect(sumMoney([], "USD").value).toBe("0.00");
    expect(mulMoney(money("0.05"), 7).value).toBe("0.35");
  });

  it("throws on currency mismatch", () => {
    expect(() => addMoney(money("1", "USD"), money("1", "EUR"))).toThrow(/Currency mismatch/);
    expect(() => cmpMoney(money("1", "USD"), money("1", "EUR"))).toThrow(/Currency mismatch/);
    expect(() => sumMoney([money("1", "EUR")], "USD")).toThrow(/Currency mismatch/);
  });

  it("formats for people", () => {
    expect(formatMoney(money("42.18"))).toBe("$42.18");
    expect(formatMoney(money("1250"))).toBe("$1,250.00");
    expect(formatMoney(money("-5"))).toBe("-$5.00");
    expect(formatMoney(money("3", "CHF"))).toBe("3.00 CHF");
  });
});
