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

export function exportLedgerPdf(
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

  const selectedGroupObj = groups.find((g) => g.id === selectedGroupId);
  const groupName = selectedGroupObj ? selectedGroupObj.name : "All Savings Groups";
  const currency = selectedGroupObj ? selectedGroupObj.currency : "LRD";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let totalIn = 0;
  let totalOut = 0;
  sorted.forEach((tx) => {
    if (tx.type === "contribution") totalIn += tx.amount;
    else if (tx.type === "payout" || tx.type === "collector_fee") totalOut += tx.amount;
  });

  const typeLabel =
    filterType === "all"
      ? "Full Financial Ledger & Audit Trail"
      : filterType === "contributions"
      ? "Member Contributions Only"
      : filterType === "payouts"
      ? "Member Payouts Only"
      : filterType === "collector_fees"
      ? "Collector Fees Only"
      : "Audit Corrections Only";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>SusuBook Financial Statement - ${groupName}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 20px; font-size: 11px; line-height: 1.4; }
          .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 16px; }
          .logo { font-size: 22px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
          .subtitle { font-size: 10px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
          .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; }
          .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
          .card { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px; border-radius: 8px; text-align: center; }
          .card-title { font-size: 9px; font-weight: 700; color: #166534; text-transform: uppercase; }
          .card-value { font-size: 15px; font-weight: 800; color: #065f46; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
          th { background: #0f172a; color: #ffffff; text-align: left; padding: 7px 10px; font-size: 9px; text-transform: uppercase; font-weight: 700; }
          td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .tag { padding: 2px 6px; border-radius: 4px; font-size: 8px; font-weight: 800; text-transform: uppercase; }
          .tag-contribution { background: #dcfce7; color: #15803d; }
          .tag-payout { background: #f3e8ff; color: #7e22ce; }
          .tag-correction { background: #fef3c7; color: #b45309; }
          .tag-collector_fee { background: #e0f2fe; color: #0369a1; }
          .footer { margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 12px; display: flex; justify-content: space-between; font-size: 9px; color: #64748b; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">💰 SusuBook</div>
            <div class="subtitle">Official Financial Ledger Statement</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; font-weight: bold; color: #0f172a;">${dateStr}</div>
            <div style="font-size: 10px; color: #64748b;">Report Scope: ${typeLabel}</div>
          </div>
        </div>

        <div class="meta-box">
          <div>
            <div><strong>Collector Name:</strong> ${collectorName}</div>
            <div><strong>Group Name:</strong> ${groupName}</div>
          </div>
          <div style="text-align: right;">
            <div><strong>Records Included:</strong> ${sorted.length} transaction(s)</div>
            <div><strong>Currency:</strong> ${currency}</div>
          </div>
        </div>

        <div class="summary-cards">
          <div class="card">
            <div class="card-title">Total Collected (In)</div>
            <div class="card-value">${currency} ${Math.round(totalIn).toLocaleString()}</div>
          </div>
          <div class="card" style="background: #fef2f2; border-color: #fecaca;">
            <div class="card-title" style="color: #991b1b;">Total Paid Out</div>
            <div class="card-value" style="color: #991b1b;">${currency} ${Math.round(totalOut).toLocaleString()}</div>
          </div>
          <div class="card" style="background: #eff6ff; border-color: #bfdbfe;">
            <div class="card-title" style="color: #1e40af;">Net Pot Balance</div>
            <div class="card-value" style="color: #1e40af;">${currency} ${Math.round(totalIn - totalOut).toLocaleString()}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Receipt / ID</th>
              <th>Date & Time</th>
              <th>Member Name</th>
              <th>Type</th>
              <th>Channel</th>
              <th style="text-align: right;">Amount (${currency})</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map((tx) => {
                const m = members.find((x) => x.id === tx.memberId);
                const name =
                  tx.memberId === "collector"
                    ? `${collectorName} (Fee)`
                    : m
                    ? m.name
                    : "Member";
                const dateFmt = tx.timestamp
                  ? new Date(tx.timestamp).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })
                  : tx.date;
                const tagClass = `tag-${tx.type}`;
                return `
                  <tr>
                    <td style="font-family: monospace; font-size: 10px;">${tx.displayId || tx.id}</td>
                    <td>${dateFmt}</td>
                    <td style="font-weight: 600;">${name}</td>
                    <td><span class="tag ${tagClass}">${tx.type.toUpperCase()}</span></td>
                    <td>${tx.method || "Cash"}</td>
                    <td style="text-align: right; font-weight: bold; color: ${
                      tx.type === "contribution" ? "#15803d" : "#b91c1c"
                    };">
                      ${tx.type === "contribution" ? "+" : "-"}${Math.round(tx.amount).toLocaleString()}
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>

        <div class="footer">
          <div>SusuBook Financial Ledger · Official Electronic Report</div>
          <div>Page 1 of 1 · Verified Ledger Audit Trail</div>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }
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
  const [selectedFormat, setSelectedFormat] = useState<"csv" | "pdf">("csv");
  const [exportSuccess, setExportSuccess] = useState<string>("");

  if (!isOpen) return null;

  const handleExport = () => {
    if (selectedFormat === "pdf") {
      exportLedgerPdf(
        state.transactions,
        state.members,
        state.groups,
        state.collectorName,
        selectedType,
        selectedMethod,
        selectedGroup
      );
      setExportSuccess("PDF Financial Statement generated for printing/saving! 📄");
    } else {
      exportLedgerCsv(
        state.transactions,
        state.members,
        state.groups,
        state.collectorName,
        selectedType,
        selectedMethod,
        selectedGroup
      );
      setExportSuccess("Ledger report generated and CSV downloaded! 📊");
    }

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
                Download CSV Spreadsheet or PDF Statement
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
              {/* Format Selection (CSV vs PDF) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Export Document Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedFormat("csv")}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      selectedFormat === "csv"
                        ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-100"
                        : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📊</span>
                      <div>
                        <p className={`text-xs font-bold ${selectedFormat === "csv" ? "text-emerald-900" : "text-gray-800"}`}>
                          CSV Spreadsheet
                        </p>
                        <p className="text-[10px] text-gray-500">Excel / Google Sheets</p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedFormat("pdf")}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      selectedFormat === "pdf"
                        ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-100"
                        : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📄</span>
                      <div>
                        <p className={`text-xs font-bold ${selectedFormat === "pdf" ? "text-emerald-900" : "text-gray-800"}`}>
                          PDF Statement
                        </p>
                        <p className="text-[10px] text-gray-500">Print / Share Report</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

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
                  Record Scope Selection
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
                    {selectedFormat === "pdf"
                      ? "Official Financial Report ready to Save as PDF"
                      : "Ready for Excel, Google Sheets, & Audits"}
                  </p>
                </div>
                <span className="px-2 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-lg uppercase">
                  {selectedFormat} Format
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
                  <span>{selectedFormat === "pdf" ? "📄 Generate PDF" : "📥 Download CSV"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
