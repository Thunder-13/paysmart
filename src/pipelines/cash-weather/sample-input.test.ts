import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/p/cash-weather/sample-input/route";
import { CashWeatherInputSchema } from "./types";

describe("GET /api/p/cash-weather/sample-input", () => {
  it("returns an input the pipeline accepts as is", async () => {
    const body = await GET().json();
    const parsed = CashWeatherInputSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.monthlyCap.value).toBe("150.00");
  });
});
