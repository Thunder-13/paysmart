/** Error thrown by both rails. Mirrors PayPal's error body: name, message, debug_id, details. */
export interface PayPalErrorDetail {
  issue: string;
  description?: string;
  field?: string;
}

export class PayPalError extends Error {
  readonly debug_id: string | null;
  readonly status: number;
  readonly details: PayPalErrorDetail[];

  constructor(input: { name: string; message: string; debug_id: string | null; status: number; details?: PayPalErrorDetail[] }) {
    const details = input.details ?? [];
    const issues = details.length
      ? ` [${details.map((d) => (d.description ? `${d.issue}: ${d.description}` : d.issue)).join("; ")}]`
      : "";
    super(`PayPal ${input.name}: ${input.message}${issues} (status ${input.status}, debug_id ${input.debug_id ?? "none"})`);
    this.name = input.name;
    this.debug_id = input.debug_id;
    this.status = input.status;
    this.details = details;
  }

  /** First issue code, e.g. "MAX_CAPTURE_AMOUNT_EXCEEDED". */
  get issue(): string | null {
    return this.details[0]?.issue ?? null;
  }
}

export function isPayPalError(e: unknown): e is PayPalError {
  return e instanceof PayPalError;
}
