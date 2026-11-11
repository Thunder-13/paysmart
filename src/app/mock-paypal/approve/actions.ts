"use server";
import { redirect } from "next/navigation";
import { getRuntime } from "@/server/runtime";
import { MOCK_BUYER_EMAIL } from "./mock-buyer";

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function orderFrom(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const mock = getRuntime().mockRail;
  if (!mock) throw new Error("The sandbox simulator only runs when PayPal is in mock mode.");
  const order = mock.inspectOrder(token);
  if (!order) throw new Error(`No simulated order ${token}`);
  return { mock, order, token };
}

/** Approve the simulated order, then go where PayPal would: the return URL with token and PayerID. */
export async function approveMockOrder(formData: FormData): Promise<void> {
  const { mock, order, token } = orderFrom(formData);
  if (order.status === "CREATED") mock.approveOrder(token, MOCK_BUYER_EMAIL);
  redirect(withParams(order.returnUrl, { token, PayerID: "MOCKBUYER01" }));
}

/** Cancel the simulated order and go to the cancel URL. */
export async function cancelMockOrder(formData: FormData): Promise<void> {
  const { mock, order, token } = orderFrom(formData);
  if (order.status === "CREATED") mock.cancelOrder(token);
  redirect(withParams(order.cancelUrl, { token }));
}
