import { useState } from "react";
import type { Group, Member, Tx } from "../hooks/useSupabaseData";

export interface AppState {
  collectorName: string;
  activeGroupId: string;
  groups: Group[];
  members: Member[];
  transactions: Tx[];
}

interface ExportMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  activeGroupId?: string;
}

export function exportMembersCsv(
  members: Member[],
  groups: Group[],
  transactions: Tx[],
  collectorName: string,
  selectedGroupId: string = "all"
) {
  const filtered = members.filter((m) => {
    return selectedGroupId === "all" || m.groupId === selectedGroupId;
  });

  const sorted = [...filtered].sort((a, b) => (a.payoutPosition || 0) - (b.payoutPosition || 0));

  const rows: string[][] = [
    [
      "Payout Position",
      "Member Code",
      "Member Full Name",
      "Phone Number",
      "Address / Community",
      "Group Name",
      "Total Contributions Collected",
    ],
  ];

  sorted.forEach((m, idx) => {
    const g = groups.find((gr) => gr.id === m.groupId);
    const groupName = g ? g.name : "General Roster";
    const code = m.memberCode || `MB${100 + idx}`;
    const mtxs = transactions.filter((t) => t.memberId === m.id && t.type === "contribution");
    const totalContributed = mtxs.reduce((sum, t) => sum + t.amount, 0);

    rows.push([
      String(m.payoutPosition || idx + 1),
      `"${code}"`,
      `"${m.name.replace(/"/g, '""')}"`,
      `"${m.phone}"`,
      `"${(m.address || "").replace(/"/g, '""')}"`,
      `"${groupName.replace(/"/g, '""')}"`,
      String(totalContributed),
    ]);
  });

  const csvContent = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestampStr = new Date().toISOString().slice(0, 10);
  const groupLabel = selectedGroupId === "all" ? "AllGroups" : "Group";
  const filename = `SusuBook_Member_Roster_${groupLabel}_${timestampStr}.csv`;

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportMembersPdf(
  members: Member[],
  groups: Group[],
  transactions: Tx[],
  collectorName: string,
  selectedGroupId: string = "all"
) {
  const filtered = members.filter((m) => {
    return selectedGroupId === "all" || m.groupId === selectedGroupId;
  });

  const sorted = [...filtered].sort((a, b) => (a.payoutPosition || 0) - (b.payoutPosition || 0));
  const selectedGroupObj = groups.find((g) => g.id === selectedGroupId);
  const groupName = selectedGroupObj ? selectedGroupObj.name : "All Savings Groups";
  const currency = selectedGroupObj ? selectedGroupObj.currency : "LRD";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>SusuBook Member Roster - ${groupName}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 20px; font-size: 11px; line-height: 1.4; }
          .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 16px; }
          .logo { font-size: 22px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
          .subtitle { font-size: 10px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
          .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
          th { background: #0f172a; color: #ffffff; text-align: left; padding: 8px 10px; font-size: 9px; text-transform: uppercase; font-weight: 700; }
          td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .code-badge { font-family: monospace; font-weight: bold; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 10px; }
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
            <div class="subtitle">Official Member Roster &amp; Directory Report</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; font-weight: bold; color: #0f172a;">${dateStr}</div>
            <div style="font-size: 10px; color: #64748b;">Group: ${groupName}</div>
          </div>
        </div>

        <div class="meta-box">
          <div>
            <div><strong>Collector Name:</strong> ${collectorName}</div>
            <div><strong>Group Name:</strong> ${groupName}</div>
          </div>
          <div style="text-align: right;">
            <div><strong>Total Members:</strong> ${sorted.length} member(s)</div>
            <div><strong>Currency:</strong> ${currency}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 35px;">Pos</th>
              <th>Member Code</th>
              <th>Member Full Name</th>
              <th>Phone Number</th>
              <th>Address / Community</th>
              <th style="text-align: right;">Contributions (${currency})</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map((m, idx) => {
                const code = m.memberCode || `MB${100 + idx}`;
                const mtxs = transactions.filter((t) => t.memberId === m.id && t.type === "contribution");
                const totalContributed = mtxs.reduce((sum, t) => sum + t.amount, 0);
                return `
                  <tr>
                    <td style="font-weight: bold;">#${m.payoutPosition || idx + 1}</td>
                    <td><span class="code-badge">${code}</span></td>
                    <td style="font-weight: 600;">${m.name}</td>
                    <td style="font-family: monospace;">${m.phone}</td>
                    <td>${m.address || "N/A"}</td>
                    <td style="text-align: right; font-weight: bold; color: #059669;">
                      ${Math.round(totalContributed).toLocaleString()}
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>

        <div class="footer">
          <div>SusuBook Member Roster Directory · Official Report</div>
          <div>Page 1 of 1 · Verified Roster Registry</div>
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

export default function ExportMembersModal({
  isOpen,
  onClose,
  state,
  activeGroupId,
}: ExportMembersModalProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>(activeGroupId || "all");
  const [selectedFormat, setSelectedFormat] = useState<"csv" | "pdf">("csv");
  const [exportSuccess, setExportSuccess] = useState<string>("");

  if (!isOpen) return null;

  const matchingMembers = state.members.filter((m: Member) => {
    return selectedGroup === "all" || m.groupId === selectedGroup;
  });

  const handleExport = () => {
    if (selectedFormat === "pdf") {
      exportMembersPdf(
        state.members,
        state.groups,
        state.transactions,
        state.collectorName,
        selectedGroup
      );
      setExportSuccess("PDF Member Roster Statement generated for printing/saving! 📄");
    } else {
      exportMembersCsv(
        state.members,
        state.groups,
        state.transactions,
        state.collectorName,
        selectedGroup
      );
      setExportSuccess("Member Roster CSV downloaded successfully! 📊");
    }

    setTimeout(() => {
      setExportSuccess("");
      onClose();
    }, 1800);
  };

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
                Export Member List &amp; Roster
              </h2>
              <p className="text-[11px] text-emerald-100 font-medium mt-1">
                Download Member Data as CSV Spreadsheet or PDF
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
                        <p
                          className={`text-xs font-bold ${
                            selectedFormat === "csv" ? "text-emerald-900" : "text-gray-800"
                          }`}
                        >
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
                        <p
                          className={`text-xs font-bold ${
                            selectedFormat === "pdf" ? "text-emerald-900" : "text-gray-800"
                          }`}
                        >
                          PDF Roster Statement
                        </p>
                        <p className="text-[10px] text-gray-500">Print / Share Report</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Group Selection */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Savings Group Roster Selection
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

              {/* Preview Banner */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-800">
                    {matchingMembers.length} member record{matchingMembers.length === 1 ? "" : "s"} selected
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {selectedFormat === "pdf"
                      ? "Official Member Directory ready to Save as PDF"
                      : "Ready for Excel & Member Directory Analysis"}
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
                  disabled={matchingMembers.length === 0}
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
