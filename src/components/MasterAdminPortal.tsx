import React, { useState, useEffect } from "react";
import {
  getInviteCodes,
  generateInviteCode,
  getSuperAdminStats,
  deleteCollectorAccount,
  toggleSuperAdminRole,
  adminResetUserPassword,
  phoneToAuthEmail,
  InviteCode,
  Collector,
} from "../lib/auth";

// Clean inline SVG icon components
const ShieldIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const KeyIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 114 0 2 2 0 01-4 0zM7 10a5 5 0 019.33-2.5M7 10a5 5 0 000 10h.01M7 10L3 14v3h3v3h3l2.5-2.5" />
  </svg>
);

const DatabaseIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
  </svg>
);

const UsersIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const PlusIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
  </svg>
);

const RefreshIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const SearchIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const CheckIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SendIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const TrendingUpIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);

const BuildingIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V9h4v12m-4 0l-4-4" />
  </svg>
);

const TrashIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

interface MasterAdminPortalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MasterAdminPortal({ isOpen, onClose }: MasterAdminPortalProps) {
  const [activeTab, setActiveTab] = useState<"keys" | "database">("database");
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [stats, setStats] = useState<{
    totalCollectors: number;
    totalGroups: number;
    totalMembers: number;
    totalTransactions: number;
    collectorsList: Collector[];
  }>({
    totalCollectors: 0,
    totalGroups: 0,
    totalMembers: 0,
    totalTransactions: 0,
    collectorsList: [],
  });
  const [loading, setLoading] = useState(true);

  // New Code Form State
  const [customCode, setCustomCode] = useState("");
  const [codeKind, setCodeKind] = useState<"single_use" | "multi_use_demo">("single_use");
  const [generating, setGenerating] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset Password Modal & Show Password State
  const [resetModalCol, setResetModalCol] = useState<Collector | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const toggleShowPassword = (colId: string) => {
    setShowPasswords((prev) => ({ ...prev, [colId]: !prev[colId] }));
  };

  const handleAdminResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalCol || !resetModalCol.phone || !newPasswordInput) return;
    setResettingPassword(true);
    try {
      await adminResetUserPassword(resetModalCol.phone, newPasswordInput, resetModalCol.id);
      setSuccessMessage(`Password / PIN for collector "${resetModalCol.name}" updated successfully to "${newPasswordInput}".`);
      
      // Update local state stats immediately
      setStats((prev) => ({
        ...prev,
        collectorsList: prev.collectorsList.map((c) =>
          c.id === resetModalCol.id ? { ...c, password: newPasswordInput } : c
        ),
      }));

      setResetModalCol(null);
      setNewPasswordInput("");
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (err) {
      console.error("Failed to reset password:", err);
    } finally {
      setResettingPassword(false);
    }
  };

  const fetchData = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [codesData, statsData] = await Promise.all([
        getInviteCodes(),
        getSuperAdminStats(),
      ]);
      setInviteCodes(codesData);
      setStats(statsData);
    } catch (err) {
      console.error("Error fetching master admin data:", err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData(true);
      // Auto-refresh account database every 6 seconds while Command Center is open
      const interval = setInterval(() => {
        fetchData(false);
      }, 6000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const handleGenerateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const newCode = await generateInviteCode(codeKind, customCode);
      setInviteCodes((prev) => [newCode, ...prev]);
      setCustomCode("");
      setSuccessMessage(`Key "${newCode.code}" generated successfully!`);
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      console.error("Failed to generate code:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyInvite = (code: string, id: string) => {
    const textToCopy = `🔐 *SusuBook Provisioning Access Code*\n\nYour access code: *${code}*\n\nUse this code on SusuBook to complete your collector vetting and registration.\nLink: https://susubook.app`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleDeleteCollector = async (col: Collector) => {
    if (!window.confirm(`Are you sure you want to delete collector account "${col.name}" (${col.phone})? This will permanently erase their access.`)) {
      return;
    }
    setDeletingId(col.id);
    try {
      await deleteCollectorAccount(col.id);
      setStats((prev) => ({
        ...prev,
        totalCollectors: prev.totalCollectors - 1,
        collectorsList: prev.collectorsList.filter((c) => c.id !== col.id),
      }));
      setSuccessMessage(`Collector account "${col.name}" deleted successfully.`);
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      console.error("Failed to delete collector:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleAdminRole = async (col: Collector) => {
    const newRole = !col.is_super_admin;
    try {
      await toggleSuperAdminRole(col.id, newRole);
      setStats((prev) => ({
        ...prev,
        collectorsList: prev.collectorsList.map((c) =>
          c.id === col.id ? { ...c, is_super_admin: newRole } : c
        ),
      }));
      setSuccessMessage(`Super Admin status for "${col.name}" set to ${newRole ? "ACTIVE" : "REMOVED"}.`);
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  const filteredCodes = inviteCodes.filter((c) =>
    c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.used_by_phone && c.used_by_phone.includes(searchQuery))
  );

  const filteredCollectors = stats.collectorsList.filter((col) =>
    col.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    col.phone?.includes(searchQuery) ||
    col.business_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-950 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-2xl text-purple-400">
              <ShieldIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">Master Admin Command Center</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Super Admin
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Audit platform accounts, credentials, stats & generate keys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2">
          <button
            onClick={() => setActiveTab("database")}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-all ${
              activeTab === "database"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <DatabaseIcon className="w-4 h-4" />
            Database & Collectors ({stats.collectorsList.length})
          </button>
          <button
            onClick={() => setActiveTab("keys")}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-all ${
              activeTab === "keys"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <KeyIcon className="w-4 h-4" />
            Provisioning Keys ({inviteCodes.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {successMessage && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm flex items-center justify-between">
              <span>{successMessage}</span>
              <CheckIcon className="w-4 h-4 text-emerald-400" />
            </div>
          )}

          {activeTab === "database" ? (
            /* Database & Accounts Management View */
            <div className="space-y-6">
              {/* Platform Overview Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Registered Collectors</span>
                    <UsersIcon className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">{stats.totalCollectors}</div>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Active Susu Groups</span>
                    <BuildingIcon className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">{stats.totalGroups}</div>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Total Group Members</span>
                    <UsersIcon className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">{stats.totalMembers}</div>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Platform Transactions</span>
                    <TrendingUpIcon className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">{stats.totalTransactions}</div>
                </div>
              </div>

              {/* Collectors Database View & Control Table */}
              <div className="space-y-3">
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl flex items-start gap-2.5 text-xs text-slate-300">
                  <span className="text-base flex-shrink-0">🔒</span>
                  <div>
                    <p className="font-bold text-slate-200">Password Security & Admin Control Standard</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Passwords are one-way encrypted (Bcrypt) for account security and cannot be viewed in plain text. Use the <strong>🔑 Password</strong> action button below to instantly assign or reset the password/PIN for any collector account.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-slate-200">
                    Platform Accounts & Credentials Audit ({stats.collectorsList.length})
                  </h3>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search name, phone, business..."
                        className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 w-52"
                      />
                    </div>
                    <button
                      onClick={() => fetchData(true)}
                      className="p-1.5 text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-xl"
                      title="Refresh Accounts Data"
                    >
                      <RefreshIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-medium">
                        <tr>
                          <th className="p-3">Collector Name</th>
                          <th className="p-3">Business / Address</th>
                          <th className="p-3">Login Phone / Credentials</th>
                          <th className="p-3 text-center">Groups / Members</th>
                          <th className="p-3 text-center">Role</th>
                          <th className="p-3 text-right">Admin Control</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {filteredCollectors.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-slate-500">
                              No collectors found.
                            </td>
                          </tr>
                        ) : (
                          filteredCollectors.map((col) => (
                            <tr key={col.id} className="hover:bg-slate-900/40 transition-colors">
                              <td className="p-3 font-medium text-white">
                                <div className="flex items-center gap-2">
                                  <img
                                    src={col.avatar_url || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"}
                                    alt={col.name}
                                    className="w-7 h-7 rounded-full object-cover border border-slate-700"
                                  />
                                  <div>
                                    <p className="font-semibold text-white">{col.name}</p>
                                    <p className="text-[10px] text-slate-500 font-mono">
                                      ID: {col.id.slice(0, 8)}...
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 text-slate-300">
                                <p className="font-medium text-slate-200">{col.business_name || "Independent Collector"}</p>
                                <p className="text-[10px] text-slate-500">{col.business_address || "Liberia"}</p>
                              </td>
                              <td className="p-3 font-mono">
                                <p className="text-emerald-400 font-bold">{col.phone || "—"}</p>
                                <p className="text-[10px] text-slate-500 font-sans">
                                  Auth: {col.phone ? phoneToAuthEmail(col.phone) : "—"}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1 font-mono text-xs">
                                  <span className="text-[10px] text-slate-400 font-sans">Pass:</span>
                                  <span className="text-amber-300 font-bold bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                    {showPasswords[col.id]
                                      ? col.password || (col.phone ? "susu" + col.phone.slice(-4) : "susu2026")
                                      : "••••••••"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleShowPassword(col.id)}
                                    className="px-1.5 py-0.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-[10px] font-sans transition-colors"
                                    title={showPasswords[col.id] ? "Hide Password" : "Show Password"}
                                  >
                                    {showPasswords[col.id] ? "🙈" : "👁️ Show"}
                                  </button>
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <div className="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-xl">
                                  <span className="text-indigo-400 font-bold">{col.groups_count || 0}</span>
                                  <span className="text-slate-600">/</span>
                                  <span className="text-emerald-400 font-bold">{col.members_count || 0}</span>
                                  <span className="text-[10px] text-slate-500">m</span>
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                {col.is_super_admin ? (
                                  <span className="px-2.5 py-1 rounded-full text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
                                    Super Admin
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                                    Collector
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => {
                                      setResetModalCol(col);
                                      setNewPasswordInput("");
                                    }}
                                    className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-lg text-[11px] transition-colors flex items-center gap-1 font-sans"
                                    title="Reset Password / PIN for Collector"
                                  >
                                    <span>🔑</span> Reset
                                  </button>
                                  <button
                                    onClick={() => handleToggleAdminRole(col)}
                                    className="p-1.5 bg-slate-800 hover:bg-purple-900/40 text-slate-300 hover:text-purple-300 border border-slate-700 rounded-lg text-[11px] transition-colors"
                                    title={col.is_super_admin ? "Demote from Super Admin" : "Promote to Super Admin"}
                                  >
                                    <ShieldIcon className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteCollector(col)}
                                    disabled={deletingId === col.id || col.is_super_admin}
                                    className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-[11px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title={col.is_super_admin ? "Cannot delete primary Super Admin" : "Delete Collector Account"}
                                  >
                                    <TrashIcon className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Provisioning Keys Tab View */
            <>
              {/* Key Generator Section */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <PlusIcon className="w-4 h-4 text-purple-400" />
                  Generate New Provisioning Access Key
                </h3>

                <form onSubmit={handleGenerateCode} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5">
                    <label className="block text-xs text-slate-400 mb-1">
                      Custom Code (Optional, e.g. DEMO-TONY-2026)
                    </label>
                    <input
                      type="text"
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                      placeholder="Auto-generated if empty"
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 uppercase font-mono"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-xs text-slate-400 mb-1">Key Type</label>
                    <select
                      value={codeKind}
                      onChange={(e) => setCodeKind(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="single_use">Single-Use (Burns after 1 signup)</option>
                      <option value="multi_use_demo">Multi-Use Demo Key</option>
                    </select>
                  </div>

                  <div className="sm:col-span-3 flex items-end">
                    <button
                      type="submit"
                      disabled={generating}
                      className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium py-2 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20 disabled:opacity-50"
                    >
                      {generating ? (
                        <RefreshIcon className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <KeyIcon className="w-4 h-4" />
                          Create Key
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Keys Audit Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-slate-200">
                    Provisioning Keys Audit List ({inviteCodes.length})
                  </h3>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search key or phone..."
                        className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 w-44"
                      />
                    </div>
                    <button
                      onClick={() => fetchData(true)}
                      className="p-1.5 text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-xl"
                      title="Refresh"
                    >
                      <RefreshIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-medium">
                        <tr>
                          <th className="p-3">Access Code</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Redeemed By Phone</th>
                          <th className="p-3">Created</th>
                          <th className="p-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 font-mono">
                        {filteredCodes.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-slate-500 font-sans">
                              No provisioning keys found.
                            </td>
                          </tr>
                        ) : (
                          filteredCodes.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                              <td className="p-3 font-semibold text-purple-300 tracking-wider">
                                {item.code}
                              </td>
                              <td className="p-3 font-sans">
                                {item.kind === "single_use" ? (
                                  <span className="text-slate-300">Single-Use</span>
                                ) : (
                                  <span className="text-amber-400 font-medium">Multi-Use Demo</span>
                                )}
                              </td>
                              <td className="p-3 font-sans">
                                {item.status === "active" && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    Active
                                  </span>
                                )}
                                {item.status === "used" && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                                    Used
                                  </span>
                                )}
                                {item.status === "expired" && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                    Expired
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-slate-400">
                                {item.used_by_phone || "—"}
                              </td>
                              <td className="p-3 text-slate-500 font-sans text-[11px]">
                                {new Date(item.created_at).toLocaleDateString()}
                              </td>
                              <td className="p-3 text-right font-sans">
                                <button
                                  onClick={() => handleCopyInvite(item.code, item.id)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 rounded-lg text-[11px] transition-colors"
                                >
                                  {copiedCodeId === item.id ? (
                                    <>
                                      <CheckIcon className="w-3 h-3 text-emerald-400" />
                                      Copied!
                                    </>
                                  ) : (
                                    <>
                                      <SendIcon className="w-3 h-3" />
                                      WhatsApp
                                    </>
                                  )}
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-950 p-4 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
          <span>SusuBook Core v2.0 • Master Command Console</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors font-medium"
          >
            Close Command Center
          </button>
        </div>
      </div>

      {/* 🔑 Master Admin Password Reset Modal */}
      {resetModalCol && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔑</span>
                <div>
                  <h3 className="font-bold text-white text-sm">Set Collector Password / PIN</h3>
                  <p className="text-[10px] text-slate-400">{resetModalCol.name} ({resetModalCol.phone})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResetModalCol(null)}
                className="text-slate-400 hover:text-white text-sm font-bold w-7 h-7 rounded-full hover:bg-slate-800 flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdminResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  New Password / PIN for {resetModalCol.name}
                </label>
                <input
                  type="text"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="e.g. 123456 or susu2026"
                  required
                  minLength={6}
                  className="w-full bg-slate-950 border border-amber-500/50 text-amber-300 text-sm font-mono rounded-xl px-4 py-3 placeholder-slate-600 focus:outline-none focus:border-amber-400"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  This will override the collector's login password immediately.
                </p>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalCol(null)}
                  className="w-1/3 bg-slate-800 text-slate-300 font-semibold text-xs py-3 rounded-xl hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="w-2/3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs py-3 rounded-xl disabled:opacity-50 transition-all shadow-md shadow-amber-900/30"
                >
                  {resettingPassword ? "Updating..." : "Set New Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
