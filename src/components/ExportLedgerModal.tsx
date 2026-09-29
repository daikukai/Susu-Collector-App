import { useState } from "react";
import type { Group, Member, Tx } from "../hooks/useSupabaseData";

export interface AppState {
  collectorName: string;
  activeGroupId: string;
  groups: Group[];
  members: Member[];
  transactions: Tx[];
}

interface ExportLedgerModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  activeGroupId?: string;
}

export function exportLedgerCsv(
  transactions: Tx[],
  members: Member[],
  groups: Group[],
  collectorName: string,
  filterType: string = "all",
  filterMethod: string = "all",
  selectedGroupId: string = "all"
) {
  const filtered = transactions.filter((tx) => {
    const matchesGroup = selectedGroupId === "all" || tx.groupId === selectedGroupId;
    const matchesType =
      filterType === "all" ||
      (filterType === "contributions" && tx.type === "contribution") ||
      (filterType === "payouts" && tx.type === "payout") ||
      (filterType === "collector_fees" && tx.type === "collector_fee") ||
      (filterType === "corrections" && tx.type === "correction");
    const matchesMethod = filterMethod === "all" || tx.method === filterMethod;
    return matchesGroup && matchesType && matchesMethod;
  });

  const sorted = [...filtered].sort((a, b) =>
    (a.timestamp || a.date).localeCompare(b.timestamp || b.date)
  );

  const rows: string[][] = [
    [
      "Receipt / Display ID",
      "Date & Time",
      "Group Name",
      "Member Code",
      "Member Name",
      "Transaction Type",
      "Payment Method",
      "Amount",
      "Note / Remarks",
      "Arrears Flag",
    ],
  ];

  sorted.forEach((tx) => {
    const m = members.find((x) => x.id === tx.memberId);
    const g = groups.find((gr) => gr.id === tx.groupId);
    const groupName = g ? g.name : "General Ledger";
    const memberName =
      tx.memberId === "collector"
        ? `${collectorName} (Fee)`
        : m
        ? m.name
        : "Member";
    const memberCode = m?.memberCode || "";
    const dateFormatted = tx.timestamp
      ? new Date(tx.timestamp).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : tx.date;

    rows.push([
      `"${tx.displayId || tx.id}"`,
      `"${dateFormatted}"`,
      `"${groupName.replace(/"/g, '""')}"`,
      `"${memberCode}"`,
      `"${memberName.replace(/"/g, '""')}"`,
      `"${tx.type.toUpperCase()}"`,
      `"${tx.method || "Cash"}"`,
      String(tx.amount),
      `"${(tx.note || "").replace(/"/g, '""')}"`,
      tx.isArrears ? "Yes" : "No",
    ]);
  });

  const csvContent = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestampStr = new Date().toISOString().slice(0, 10);
  const groupLabel = selectedGroupId === "all" ? "AllGroups" : "Group";
  const filename = `SusuBook_Ledger_${groupLabel}_${filterType.toUpperCase()}_${timestampStr}.csv`;

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function ExportLedgerModal({
  isOpen,
  onClose,
  state,
  activeGroupId,
}: ExportLedgerModalProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>(activeGroupId || "all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedMethod, setSelectedMethod] = useState<string>("all");
  const [exportSuccess, setExportSuccess] = useState<string>("");

  if (!isOpen) return null;

  const handleExport = () => {
    exportLedgerCsv(
      state.transactions,
      state.members,
      state.groups,
      state.collectorName,
      selectedType,
      selectedMethod,
      selectedGroup
    );
    setExportSuccess("Ledger report generated and CSV downloaded successfully! 🚀");
    setTimeout(() => {
      setExportSuccess("");
      onClose();
    }, 1800);
  };

  const matchingCount = state.transactions.filter((tx: Tx) => {
    const matchesGroup = selectedGroup === "all" || tx.groupId === selectedGroup;
    const matchesType =
      selectedType === "all" ||
      (selectedType === "contributions" && tx.type === "contribution") ||
      (selectedType === "payouts" && tx.type === "payout") ||
      (selectedType === "collector_fees" && tx.type === "collector_fee") ||
      (selectedType === "corrections" && tx.type === "correction");
    const matchesMethod = selectedMethod === "all" || tx.method === selectedMethod;
    return matchesGroup && matchesType && matchesMethod;
  }).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden transition-all">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-600 p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-xl">
              📥
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight leading-none">
                Export Ledger &amp; Audit Trail
              </h2>
              <p className="text-[11px] text-emerald-100 font-medium mt-1">
                Custom Selection CSV Report Generator
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-xs transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {exportSuccess ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
              <span className="text-3xl">✅</span>
              <p className="text-xs font-bold text-emerald-900">{exportSuccess}</p>
            </div>
          ) : (
            <>
              {/* Filter 1: Group Selection */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Savings Group Selection
                </label>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-xs font-medium rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">All Savings Groups ({state.groups.length})</option>
                  {state.groups.map((g: Group) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.currency})
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter 2: Transaction Type Selection */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Export Record Selection (Type)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "all", label: "📋 All Records", desc: "Full Ledger & Audit" },
                    { id: "contributions", label: "🟢 Contributions", desc: "Daily Roster Payments" },
                    { id: "payouts", label: "🟣 Member Payouts", desc: "Completed Cycle Payouts" },
                    { id: "collector_fees", label: "💼 Collector Fees", desc: "Commissions Collected" },
                    { id: "corrections", label: "⚖️ Audit Corrections", desc: "Ledger Adjustments" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedType(item.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        selectedType === item.id
                          ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-100"
                          : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      <p className={`text-xs font-bold ${selectedType === item.id ? "text-emerald-900" : "text-gray-800"}`}>
                        {item.label}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{item.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter 3: Payment Method */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Payment Channel Method
                </label>
                <div className="flex gap-2">
                  {["all", "Cash", "MTN", "Orange"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMethod(m)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                        selectedMethod === m
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {m === "all" ? "All Methods" : m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview Banner */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-800">
                    {matchingCount} transaction row{matchingCount === 1 ? "" : "s"} selected
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Ready for Excel, Google Sheets, &amp; Financial Audits
                  </p>
                </div>
                <span className="px-2 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-lg">
                  CSV Format
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={matchingCount === 0}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <span>📥 Download CSV</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
