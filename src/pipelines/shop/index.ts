/**
 * Shop pipeline: Permission Slip shopping with the red-team listing, hire-a-helper child slips
 * and the voice add-on (client side). Spec: openspec/changes/add-shop-pipeline.
 */
import type { PipelineDefinition } from "@/core/contracts";
import { SHOP_META } from "./meta";
import { createShopSteps, initialShopState, type ShopOptions } from "./steps";
import { ShopInputSchema, type ShopInput, type ShopState } from "./types";

export function createShopPipeline(opts: ShopOptions = {}): PipelineDefinition<ShopInput, ShopState> {
  return {
    id: "shop",
    title: SHOP_META.title,
    tagline: SHOP_META.tagline,
    primitives: [...SHOP_META.primitives],
    input: ShopInputSchema,
    initialState: initialShopState,
    firstStep: "intake",
    steps: createShopSteps(opts),
  };
}

const definition = createShopPipeline();

export default definition;
