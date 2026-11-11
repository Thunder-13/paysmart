/** Family mode: in-app trusted-contact inbox, store.collection("second-look", "alerts"). No email or SMS. */
import type { Store } from "@/core/contracts";
import { newId } from "@/core/ids";
import type { FamilyAlert } from "./types";

export function alertsCollection(store: Store) {
  return store.collection<FamilyAlert>("second-look", "alerts");
}

/**
 * Writes an alert unless one already exists for this run and reason. Returns null when there is no
 * trusted contact (family mode off).
 */
export function writeAlert(
  store: Store,
  input: Omit<FamilyAlert, "id" | "createdAt" | "read" | "to"> & { to: string | null | undefined },
  now: Date,
): FamilyAlert | null {
  const to = input.to?.trim().toLowerCase();
  if (!to) return null;
  const col = alertsCollection(store);
  const existing = col.list().find((a) => a.runId === input.runId && a.reason === input.reason);
  if (existing) return existing;
  const alert: FamilyAlert = { ...input, to, id: newId("alert"), createdAt: now.toISOString(), read: false };
  return col.put(alert.id, alert);
}

/** Alerts for one trusted contact (or all when `to` is empty), newest first. */
export function listAlerts(store: Store, to?: string | null): FamilyAlert[] {
  const who = to?.trim().toLowerCase();
  return alertsCollection(store)
    .list()
    .filter((a) => !who || a.to === who)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
