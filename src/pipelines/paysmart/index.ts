/**
 * PaySmart pipeline: plain-words front door. Route, discover, screen, assemble carts, choose, pay.
 * Spec: openspec/changes/add-paysmart-pipeline.
 */
import type { PipelineDefinition } from "@/core/contracts";
import { PAYSMART_META } from "./meta";
import { createPaySmartSteps, initialPaySmartState, type PaySmartOptions } from "./steps";
import { PaySmartInputSchema, type PaySmartInput, type PaySmartState } from "./types";

export function createPaySmartPipeline(opts: PaySmartOptions = {}): PipelineDefinition<PaySmartInput, PaySmartState> {
  return {
    id: "paysmart",
    title: PAYSMART_META.title,
    tagline: PAYSMART_META.tagline,
    primitives: [...PAYSMART_META.primitives],
    input: PaySmartInputSchema,
    initialState: initialPaySmartState,
    firstStep: "intake",
    steps: createPaySmartSteps(opts),
  };
}

const definition = createPaySmartPipeline();

export default definition;
