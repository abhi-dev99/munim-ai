"use client";
import { authFetch, adminHeaders, ensureAdminKey } from "@/src/app/utils/api";


import { useState, useEffect } from "react";
import { Trash2, Loader2, AlertCircle } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AdminPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [traders, setTraders] = useState([]);
  const [selectedTrader, setSelectedTrader] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Ops surface: the delete endpoints below are gated on X-Admin-Key, which
  // is no longer baked into the bundle -- prompt for it once per session.
  useEffect(() => {
    ensureAdminKey();
  }, []);

  useEffect(() => {
    async function fetchTraders() {
      try {
        const res = await authFetch(`${API_BASE}/api/v1/dashboard/traders`);
        if (!res.ok) throw new Error("Failed to fetch traders");
        const data = await res.json();
        setTraders(data.traders || []);
        if (data.traders?.length > 0) {
          setSelectedTrader(data.traders[0].id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    }
    fetchTraders();
  }, []);

  useEffect(() => {
    if (!selectedTrader) return;

    async function fetchInvoices() {
      setLoading(true);
      // Switching traders invalidates whatever was selected for the last one --
      // the IDs wouldn't even belong to this trader's list any more.
      setSelectedIds(new Set());
      try {
        const res = await authFetch(`${API_BASE}/api/v1/dashboard/invoices/${selectedTrader}`);
        if (!res.ok) throw new Error("Failed to fetch invoices");
        const data = await res.json();
        setInvoices(data.invoices || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchInvoices();
  }, [selectedTrader]);

  async function handleDelete(id) {
    if (!window.confirm("Are you sure you want to delete this invoice?")) return;

    try {
      const res = await authFetch(`${API_BASE}/api/v1/admin/invoices/${id}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error("Delete failed");

      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      alert("Failed to delete invoice.");
    }
  }

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === invoices.length ? new Set() : new Set(invoices.map((inv) => inv.id))
    );
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected invoice${ids.length > 1 ? "s" : ""}? This can't be undone.`)) return;

    setBulkDeleting(true);
    // Fired in parallel and settled individually rather than aborting the
    // whole batch on the first failure -- a partial cleanup (delete
    // everything that actually succeeds, report exactly what didn't) is more
    // useful here than an all-or-nothing bulk op, especially for a demo
    // cleanup tool where "most of it worked" beats "none of it did."
    const results = await Promise.allSettled(
      ids.map((id) =>
        authFetch(`${API_BASE}/api/v1/admin/invoices/${id}`, {
          method: "DELETE",
          headers: adminHeaders(),
        }).then((res) => {
          if (!res.ok) throw new Error(`Delete failed for ${id}`);
          return id;
        })
      )
    );

    const succeededIds = new Set(
      results.filter((r) => r.status === "fulfilled").map((r) => r.value)
    );
    const failedCount = results.length - succeededIds.size;

    setInvoices((prev) => prev.filter((inv) => !succeededIds.has(inv.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      succeededIds.forEach((id) => next.delete(id));
      return next;
    });
    setBulkDeleting(false);

    if (failedCount > 0) {
      alert(`Deleted ${succeededIds.size} invoice(s). ${failedCount} failed -- still selected, try again.`);
    }
  }

  const allSelected = invoices.length > 0 && selectedIds.size === invoices.length;

  return (
    <div className="min-h-screen p-8 bg-[#f4f4f5]">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black text-black tracking-tighter uppercase mb-2">Admin Dashboard</h1>
            <p className="text-[var(--text-secondary)] font-medium">Manage and remove test transactions</p>
          </div>

          <select
            value={selectedTrader || ""}
            onChange={(e) => setSelectedTrader(e.target.value)}
            className="p-2 border border-[var(--border-subtle)] bg-white font-bold"
          >
            {traders.map(t => (
              <option key={t.id} value={t.id}>{t.name || t.business_name} ({t.id.slice(0,8)})</option>
            ))}
          </select>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between bg-black text-white px-5 py-3 rounded">
            <span className="text-sm font-bold">{selectedIds.size} selected</span>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--red-primary)] hover:bg-red-600 disabled:opacity-50 text-white text-sm font-bold rounded transition-colors"
            >
              {bulkDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              <span>{bulkDeleting ? "Deleting..." : "Delete selected"}</span>
            </button>
          </div>
        )}

        <div className="bg-white border border-[var(--border-subtle)]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={invoices.length === 0}
                    aria-label="Select all invoices"
                  />
                </th>
                <th className="p-4 text-sm font-semibold text-black uppercase tracking-wider">Date</th>
                <th className="p-4 text-sm font-semibold text-black uppercase tracking-wider">Supplier</th>
                <th className="p-4 text-sm font-semibold text-black uppercase tracking-wider">Amount</th>
                <th className="p-4 text-sm font-semibold text-black uppercase tracking-wider">Status</th>
                <th className="p-4 text-sm font-semibold text-black uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center"><Loader2 className="animate-spin mx-auto text-black" /></td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-[var(--text-secondary)] font-medium">No invoices found.</td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] ${selectedIds.has(inv.id) ? "bg-red-50/40" : ""}`}
                  >
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(inv.id)}
                        onChange={() => toggleOne(inv.id)}
                        aria-label={`Select invoice from ${inv.supplier_name || "unknown supplier"}`}
                      />
                    </td>
                    <td className="p-4 text-sm font-medium">{inv.invoice_date?.slice(0, 10) || "N/A"}</td>
                    <td className="p-4 text-sm font-bold text-black">{inv.supplier_name || inv.gstin_supplier || "Unknown"}</td>
                    <td className="p-4 text-sm font-medium">₹{Number(inv.total_amount || 0).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-sm font-medium">{inv.itc_status}</td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleDelete(inv.id)}
                        className="p-2 text-[var(--red-primary)] hover:bg-red-50 transition-colors"
                        title="Delete Invoice"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
