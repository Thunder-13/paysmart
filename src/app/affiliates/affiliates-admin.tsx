"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Network = "amazon" | "flipkart" | "myntra" | "instagram" | "facebook" | "generic";

interface Account {
  id: string;
  network: Network;
  label: string;
  trackingId: string;
  domains: string[];
  params: Record<string, string>;
  template: string | null;
  commissionBps: number | null;
  active: boolean;
}

interface Preset {
  label: string;
  domains: string[];
  params: Record<string, string>;
  needsUserLink: boolean;
  note: string;
}

interface Form {
  editing: string | null;
  network: Network;
  label: string;
  trackingId: string;
  domains: string;
  params: string;
  template: string;
  commission: string;
  active: boolean;
}

const STORAGE_KEY = "affiliate-admin-secret";
const NETWORKS: Network[] = ["amazon", "flipkart", "myntra", "instagram", "facebook", "generic"];

const field = "field mt-1 w-full px-4 py-2.5 text-base text-ink placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-pp-blue";
const button =
  "inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue";
const quiet =
  "inline-flex h-9 items-center rounded-pill border border-edge bg-card px-4 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue";

const secondary =
  "inline-flex h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue";

const emptyForm = (network: Network, presets: Record<string, Preset> | null): Form => ({
  editing: null,
  network,
  label: "",
  trackingId: "",
  domains: presets?.[network]?.domains.join(", ") ?? "",
  params: Object.entries(presets?.[network]?.params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n"),
  template: "",
  commission: "",
  active: true,
});

function parseParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

export function AffiliatesAdmin() {
  const [secret, setSecret] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [presets, setPresets] = useState<Record<string, Preset> | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm("amazon", null));
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testUrl, setTestUrl] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const api = useCallback(
    async (path: string, init: { method?: string; body?: unknown } = {}, key = secret): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
      const res = await fetch(path, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: res.ok, status: res.status, data };
    },
    [secret],
  );

  const load = useCallback(
    async (key: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await api("/api/affiliates", {}, key);
        if (!r.ok) {
          setAccounts(null);
          setMessage({
            kind: "error",
            text: r.status === 404 ? "Affiliate admin is off. Set AFFILIATE_ADMIN_SECRET on the server." : r.status === 401 ? "That secret was not accepted." : "Could not load accounts.",
          });
          return;
        }
        setAccounts(r.data.accounts as Account[]);
        setPresets(r.data.presets as Record<string, Preset>);
        sessionStorage.setItem(STORAGE_KEY, key);
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      // Restore the secret typed earlier in this tab and load with it.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from sessionStorage, which is not available during render on the server
      setSecret(saved);
      void load(saved);
    }
  }, [load]);

  function pickNetwork(network: Network) {
    setForm({ ...emptyForm(network, presets), editing: form.editing, trackingId: form.trackingId, label: form.label, commission: form.commission, active: form.active });
  }

  function edit(a: Account) {
    setForm({
      editing: a.id,
      network: a.network,
      label: a.label,
      trackingId: a.trackingId,
      domains: a.domains.join(", "),
      params: Object.entries(a.params)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      template: a.template ?? "",
      commission: a.commissionBps === null ? "" : String(a.commissionBps / 100),
      active: a.active,
    });
    setMessage(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const percent = form.commission.trim() === "" ? null : Number(form.commission);
    if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
      setMessage({ kind: "error", text: "Commission is a percent from 0 to 100." });
      return;
    }
    const body = {
      network: form.network,
      label: form.label.trim() || undefined,
      trackingId: form.trackingId.trim(),
      domains: form.domains
        .split(/[,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean),
      params: parseParams(form.params),
      template: form.template.trim() === "" ? null : form.template.trim(),
      commissionBps: percent === null ? null : Math.round(percent * 100),
      active: form.active,
    };
    setBusy(true);
    try {
      const r = form.editing
        ? await api(`/api/affiliates/${encodeURIComponent(form.editing)}`, { method: "PATCH", body: { ...body, label: form.label.trim() || (presets?.[form.network]?.label ?? "Account") } })
        : await api("/api/affiliates", { method: "POST", body });
      if (!r.ok) {
        setMessage({ kind: "error", text: String(r.data.error ?? "Could not save the account.") });
        return;
      }
      setMessage({ kind: "ok", text: form.editing ? "Account updated." : "Account added." });
      setForm(emptyForm(form.network, presets));
      await load(secret);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: Account) {
    const r = await api(`/api/affiliates/${encodeURIComponent(a.id)}`, { method: "PATCH", body: { active: !a.active } });
    setMessage(r.ok ? { kind: "ok", text: a.active ? "Account switched off." : "Account switched on." } : { kind: "error", text: String(r.data.error ?? "Could not update.") });
    await load(secret);
  }

  async function remove(a: Account) {
    if (!window.confirm(`Delete ${a.label}? Links stop carrying this ID.`)) return;
    const r = await api(`/api/affiliates/${encodeURIComponent(a.id)}`, { method: "DELETE" });
    setMessage(r.ok ? { kind: "ok", text: "Account deleted." } : { kind: "error", text: String(r.data.error ?? "Could not delete.") });
    await load(secret);
  }

  async function test(e: FormEvent) {
    e.preventDefault();
    const r = await api("/api/affiliates/preview", { method: "POST", body: { url: testUrl } });
    if (!r.ok) {
      setTestResult(String(r.data.error ?? "Could not test that link."));
      return;
    }
    const link = r.data.link as { url: string; label: string } | null;
    setTestResult(link ? `${link.url}\n(account: ${link.label})` : "No active account matches this link. It stays as it is.");
  }

  const preset = presets?.[form.network];
  const showNote = form.network === "myntra" || form.network === "instagram" || form.network === "facebook";

  return (
    <div className="mt-6 space-y-8">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load(secret);
        }}
      >
        <div className="min-w-64 flex-1">
          <label htmlFor="aff-secret" className="block text-sm font-semibold text-ink">
            Admin secret
          </label>
          <input id="aff-secret" type="password" autoComplete="off" className={field} value={secret} onChange={(e) => setSecret(e.target.value)} />
        </div>
        <button type="submit" className={secondary} disabled={busy || secret === ""}>
          Load accounts
        </button>
      </form>

      <div aria-live="polite">
        {message && (
          <p className={`rounded-md border px-4 py-2.5 text-sm ${message.kind === "ok" ? "border-stamp-green bg-green-wash text-ink" : "border-stamp-red bg-red-wash text-ink"}`}>{message.text}</p>
        )}
      </div>

      {accounts && (
        <>
          <section aria-labelledby="aff-list">
            <h2 id="aff-list" className="font-display text-xl font-extrabold tracking-tight text-ink">
              Accounts
            </h2>
            {accounts.length === 0 ? (
              <p className="mt-2 text-ink-soft">No accounts yet. Add one below.</p>
            ) : (
              <div tabIndex={0} role="region" aria-labelledby="aff-list" className="mt-3 overflow-x-auto rounded-card border border-line bg-card">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-ink-soft">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Label</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Network</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Tracking ID</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Domains</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Commission</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} className="border-t border-line align-top transition-colors duration-[120ms] hover:bg-paper">
                        <td className="px-4 py-3 text-ink">{a.label}</td>
                        <td className="px-4 py-3 text-ink-soft">{a.network}</td>
                        <td className="px-4 py-3 font-mono text-ink">{a.trackingId}</td>
                        <td className="px-4 py-3 text-ink-soft">{a.domains.join(", ")}</td>
                        <td className="px-4 py-3 text-ink-soft">{a.commissionBps === null ? "not set" : `${a.commissionBps / 100}%`}</td>
                        <td className="px-4 py-3">
                          <span className={a.active ? "text-stamp-green" : "text-ink-faint"}>{a.active ? "On" : "Off"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className={quiet} onClick={() => edit(a)}>
                              Edit
                            </button>
                            <button type="button" className={quiet} onClick={() => void toggle(a)}>
                              {a.active ? "Switch off" : "Switch on"}
                            </button>
                            <button type="button" className={`${quiet} border-stamp-red text-stamp-red hover:border-stamp-red hover:bg-red-wash active:bg-red-wash disabled:opacity-55`} onClick={() => void remove(a)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="aff-form">
            <h2 id="aff-form" className="font-display text-xl font-extrabold tracking-tight text-ink">
              {form.editing ? "Edit account" : "Add an account"}
            </h2>
            <form className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2" onSubmit={(e) => void save(e)}>
              <div>
                <label htmlFor="aff-network" className="block text-sm font-semibold text-ink">Network</label>
                <select id="aff-network" className={field} value={form.network} onChange={(e) => pickNetwork(e.target.value as Network)}>
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {presets?.[n]?.label ?? n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="aff-label" className="block text-sm font-semibold text-ink">Label</label>
                <input id="aff-label" className={field} value={form.label} placeholder={preset?.label ?? ""} maxLength={80} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              {showNote && preset && (
                <p className="rounded-md border border-pp-gold bg-pp-gold-wash px-4 py-2.5 text-sm text-ink sm:col-span-2" role="note">
                  {preset.note}
                </p>
              )}
              <div>
                <label htmlFor="aff-id" className="block text-sm font-semibold text-ink">Tracking ID</label>
                <input id="aff-id" className={`${field} font-mono`} value={form.trackingId} required minLength={2} maxLength={64} onChange={(e) => setForm({ ...form, trackingId: e.target.value })} />
                {!showNote && preset && <p className="mt-1 text-xs text-ink-soft">{preset.note}</p>}
              </div>
              <div>
                <label htmlFor="aff-commission" className="block text-sm font-semibold text-ink">Commission rate (percent, optional)</label>
                <input id="aff-commission" inputMode="decimal" className={field} value={form.commission} placeholder="4" onChange={(e) => setForm({ ...form, commission: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="aff-domains" className="block text-sm font-semibold text-ink">Domains (comma separated)</label>
                <input id="aff-domains" className={`${field} font-mono`} value={form.domains} placeholder="amazon.in, amazon.com" onChange={(e) => setForm({ ...form, domains: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aff-params" className="block text-sm font-semibold text-ink">Link parameters (one name=value per line, {"{id}"} is the tracking ID)</label>
                <textarea id="aff-params" rows={3} className={`${field} font-mono`} value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aff-template" className="block text-sm font-semibold text-ink">Deep-link template (optional, https, with {"{url}"})</label>
                <textarea id="aff-template" rows={3} className={`${field} font-mono`} value={form.template} placeholder="https://links.example/go?u={url}&s={id}" onChange={(e) => setForm({ ...form, template: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input id="aff-active" type="checkbox" className="h-4 w-4 accent-pp-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                <label htmlFor="aff-active" className="text-sm text-ink">Active</label>
              </div>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <button type="submit" className={button} disabled={busy}>
                  {form.editing ? "Save changes" : "Add account"}
                </button>
                {form.editing && (
                  <button type="button" className={quiet} onClick={() => setForm(emptyForm(form.network, presets))}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          </section>

          <section aria-labelledby="aff-test">
            <h2 id="aff-test" className="font-display text-xl font-extrabold tracking-tight text-ink">
              Test a link
            </h2>
            <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => void test(e)}>
              <div className="min-w-64 flex-1">
                <label htmlFor="aff-test-url" className="block text-sm font-semibold text-ink">Retailer link</label>
                <input id="aff-test-url" type="url" required className={field} value={testUrl} placeholder="https://www.amazon.in/dp/B0EXAMPLE" onChange={(e) => setTestUrl(e.target.value)} />
              </div>
              <button type="submit" className={secondary}>
                Test link
              </button>
            </form>
            <p aria-live="polite" className="mt-3 whitespace-pre-wrap break-all rounded-md bg-paper-deep px-4 py-2.5 font-mono text-sm text-ink empty:hidden">
              {testResult}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
