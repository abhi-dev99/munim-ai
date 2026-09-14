"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingDown, Info, RefreshCw } from "lucide-react";
import { getMissedItc } from "../utils/api";
import PanelState, { describeError } from "./PanelState";

/**
 * Unclaimed input tax credit — the supplier told the portal they sold to this
 * trader, but no invoice was ever matched against that GSTR-2B row.
 *
 * This is the one number in the product a shopkeeper cares about without
 * needing any GST vocabulary explained: money already earned and not taken.
 * Everything else Munim computes is a compliance position; this is a refund
 * sitting unclaimed.
 *
 * The panel never calls /gstr2b/reconcile — that endpoint writes match state
 * and can email vendors when auto_warn_vendors is on, which is not something
 * a dashboard render should trigger.
 */

const inr = (n) =>
  `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export default function MissedITCPanel({ traderId, apiBase, month, year }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!traderId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getMissedItc(apiBase, traderId, month, year));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [traderId, apiBase, month, year]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PanelState state="loading" rows={3} />;
  if (error) {
    return (
      <PanelState
        state="error"
        error={error}
        message={describeError(error)}
        onRetry={load}
      />
    );
  }

  const records = data?.records || [];

  // No 2B uploaded at all is a different story from "everything is claimed",
  // and conflating them would tell a CA their books are clean when in fact
  // nothing has been checked.
  if (!data?.gstr2b_records) {
    return (
      <PanelState
        state="empty"
        title="No GSTR-2B for this period"
        message="Upload the GSTR-2B export from the GST portal to see credit your suppliers reported but you have not claimed."
      />
    );
  }

  if (!records.length) {
    return (
      <PanelState
        state="empty"
        title="Nothing unclaimed"
        message={`Every GSTR-2B row for ${data.period} is matched to an invoice. No credit is being left behind.`}
      />
    );
  }

  return (
    <section
      className="bg-white border border-[var(--border-subtle)] rounded-none"
      aria-labelledby="missed-itc-heading"
    >
      <header className="flex items-start justify-between gap-3 p-3 sm:p-4 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <h2
            id="missed-itc-heading"
            className="text-sm font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2"
          >
            <TrendingDown className="w-4 h-4" style={{ color: "var(--red-primary)" }} aria-hidden="true" />
            Unclaimed credit
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Reported by suppliers for {data.period}, never claimed
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh unclaimed credit"
          className="shrink-0 p-1.5 border border-[var(--border-subtle)] hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
        </button>
      </header>

      <div className="p-3 sm:p-4 border-b border-[var(--border-subtle)]">
        <p className="text-2xl sm:text-3xl font-bold tracking-tight break-words" style={{ color: "var(--red-primary)" }}>
          {inr(data.unclaimed_tax)}
        </p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          across {data.count} invoice{data.count === 1 ? "" : "s"} worth{" "}
          {inr(data.unclaimed_taxable)} in purchases
        </p>
      </div>

      {/* The figure is only meaningful once matching has been attempted. Before
          that every row is unmatched by definition, so the backend flags it
          rather than letting the panel quote a number the CA would have to
          disbelieve. */}
      {!data.reconciled && data.note && (
        <div
          role="note"
          className="flex gap-2 p-3 text-xs leading-relaxed"
          style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
        >
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{data.note}</span>
        </div>
      )}

      <ul className="divide-y divide-[var(--border-subtle)] max-h-80 overflow-y-auto">
        {records.slice(0, 25).map((r) => (
          <li key={r.record_id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {r.supplier_name}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {r.invoice_number || "no number"} · {r.invoice_date || "no date"}
              </p>
            </div>
            <p className="text-sm font-bold text-[var(--text-primary)] shrink-0 tabular-nums">
              {inr(r.tax)}
            </p>
          </li>
        ))}
      </ul>

      {records.length > 25 && (
        <p className="p-3 text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
          Showing the 25 largest of {records.length}.
        </p>
      )}
    </section>
  );
}
