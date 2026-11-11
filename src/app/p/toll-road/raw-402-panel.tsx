"use client";
import { useEffect, useState } from "react";

const SHOWN_HEADERS: [string, string][] = [
  ["www-authenticate", "WWW-Authenticate"],
  ["content-type", "Content-Type"],
  ["cache-control", "Cache-Control"],
  ["x-toll-price", "X-Toll-Price"],
];

const REASONS: Record<number, string> = { 200: "OK", 402: "Payment Required", 404: "Not Found" };

export interface RawQuotePanelProps {
  articles: { id: string; title: string }[];
  baseUrl: string;
}

/**
 * Sends a real unpaid GET to the toll booth from the browser and prints exactly what came back:
 * status line, the headers that matter and the JSON body.
 */
export function RawQuotePanel({ articles, baseUrl }: RawQuotePanelProps) {
  const [contentId, setContentId] = useState(articles[0]?.id ?? "");
  const [nonce, setNonce] = useState(0);
  const [shown, setShown] = useState<{ key: string; text: string; status: number | null } | null>(null);
  const key = `${contentId}#${nonce}`;

  useEffect(() => {
    if (!contentId) return;
    let cancelled = false;
    const requestKey = `${contentId}#${nonce}`;
    fetch(`/api/p/toll-road/content/${encodeURIComponent(contentId)}`, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const raw = await res.text();
        let pretty = raw;
        try {
          pretty = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          // not JSON; print as is
        }
        const lines = [`HTTP/1.1 ${res.status} ${res.statusText || REASONS[res.status] || ""}`.trim()];
        for (const [name, label] of SHOWN_HEADERS) {
          const value = res.headers.get(name);
          if (value) lines.push(`${label}: ${value}`);
        }
        if (!cancelled) setShown({ key: requestKey, text: `${lines.join("\n")}\n\n${pretty}`, status: res.status });
      })
      .catch((e: unknown) => {
        if (!cancelled) setShown({ key: requestKey, text: `Request failed: ${e instanceof Error ? e.message : String(e)}`, status: null });
      });
    return () => {
      cancelled = true;
    };
  }, [contentId, nonce]);

  const current = shown && shown.key === key ? shown : null;
  const curl = `curl -i ${baseUrl}/api/p/toll-road/content/${contentId}`;

  const [statusLine, ...bodyLines] = (current ? current.text : "Sending…").split("\n");

  return (
    <section aria-labelledby="raw-402-title" className="on-night min-w-0 rounded-2xl bg-night p-5 text-on-night sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id="raw-402-title" className="font-display text-xl font-extrabold tracking-tight text-on-night">
            The booth, unpaid
          </h2>
          <p className="mt-1 max-w-[46ch] text-sm text-on-night-soft">A real request with no slip attached. This is what any crawler sees first.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <label className="text-sm text-on-night-soft">
            <span className="block">Article</span>
            <select
              value={contentId}
              onChange={(e) => setContentId(e.target.value)}
              className="field mt-1 h-11 max-w-[14rem] px-4 font-mono text-sm text-ink"
            >
              {articles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}: {a.title.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-pill border border-on-night-soft bg-night-2 px-5 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:border-on-night focus-visible:outline-offset-4 active:bg-night-3"
          >
            Send again
          </button>
        </div>
      </header>
      <p className="mt-5 whitespace-pre-wrap rounded-md bg-night-2 px-4 py-3 font-mono text-sm text-on-night [overflow-wrap:anywhere]">
        <span aria-hidden="true" className="select-none text-pp-sky">
          ${" "}
        </span>
        {curl}
      </p>
      <pre
        tabIndex={0}
        role="region"
        aria-label="Raw HTTP response"
        aria-busy={!current}
        className={`mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border bg-night-2 px-4 py-3 font-mono text-sm leading-relaxed text-on-night-soft ${
          current?.status === 402 ? "border-stamp-red" : "border-night-line"
        }`}
      >
        <span className="font-semibold text-on-night">{statusLine}</span>
        {bodyLines.length > 0 ? `\n${bodyLines.join("\n")}` : ""}
      </pre>
    </section>
  );
}

export default RawQuotePanel;
