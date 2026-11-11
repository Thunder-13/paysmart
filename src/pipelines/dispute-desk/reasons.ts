/** PayPal dispute reason codes in plain words. Pure; safe for client components. */
export const REASON_NOT_RECEIVED = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
export const REASON_NOT_AS_DESCRIBED = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
export const REASON_UNAUTHORISED = "UNAUTHORISED";
export const REASON_CREDIT_NOT_PROCESSED = "CREDIT_NOT_PROCESSED";

const LABELS: Record<string, string> = {
  [REASON_NOT_RECEIVED]: "Item not received",
  [REASON_NOT_AS_DESCRIBED]: "Not as described",
  [REASON_UNAUTHORISED]: "Didn't authorize the payment",
  [REASON_CREDIT_NOT_PROCESSED]: "Refund not received",
  DUPLICATE_TRANSACTION: "Charged twice",
  INCORRECT_AMOUNT: "Wrong amount",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  PROBLEM_WITH_REMITTANCE: "Problem with remittance",
  OTHER: "Other",
};

export function reasonLabel(reason: string): string {
  return LABELS[reason] ?? reason.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** What a merchant needs on file to contest a dispute with this reason. */
export function missingForReason(reason: string): string[] {
  switch (reason) {
    case REASON_NOT_RECEIVED:
      return ["A tracking number or proof of delivery"];
    case REASON_NOT_AS_DESCRIBED:
      return ["Photos of the item as shipped", "The listing or terms the buyer agreed to"];
    case REASON_UNAUTHORISED:
      return ["Proof the buyer approved the payment"];
    case REASON_CREDIT_NOT_PROCESSED:
      return ["The refund record"];
    default:
      return ["Proof of delivery or service"];
  }
}
