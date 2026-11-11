/** Test helper: a shop run waiting at complete_signing, before the buyer approves at PayPal. */
import { shopRuntime, waitData } from "@/pipelines/shop/test-utils";

export async function runToCartPrefix() {
  const rt = shopRuntime();
  let run = await rt.orchestrator.start("shop", {});
  run = await rt.orchestrator.resume(run.id, { approved: true });
  if (run.step !== "complete_signing") throw new Error(`expected complete_signing, got ${run.status} ${run.step}`);
  return { rt, run, orderId: String(waitData(run).orderId) };
}
