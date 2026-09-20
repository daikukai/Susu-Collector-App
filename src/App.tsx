import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./contexts/AuthContext";
import { useDexieSync } from "./hooks/useDexieSync";
import { db, enqueueSync } from "./lib/db";
import { PWAInstallBanner } from "./components/PWAInstallBanner";
import { SusuCardModal } from "./components/SusuCardModal";
import UserProfileModal from "./components/UserProfileModal";
import MasterAdminPortal from "./components/MasterAdminPortal";
import {
  useGroups,
  useMembers,
  useTransactions,
  useRollovers,
  useDisputes,
  useSmsLog,
  useCreateGroup,
  useUpdateGroup,
  useCreateMember,
  useUpdateMember,
  useCreateTransaction,
  useCreateSmsEntry,
  useCreateDispute,
  useUpdateDispute,
  useCreateRollover,
  useDeleteGroup,
  useDeleteMember,
  useRecordPayment,
  useRecordCorrection,
  useCloseCycle,
  type Group,
  type Member,
  type Tx,
  type Dispute,
  type Rollover,
  type SmsEntry,
} from "./hooks/useSupabaseData";

// ── Types ──────────────────────────────────────────────────────────────────────
type NavTab = "today" | "collect" | "members" | "finance" | "admin";

interface AppState {
  collectorName: string; activeGroupId: string;
  groups: Group[]; members: Member[]; transactions: Tx[];
  rollovers: Rollover[]; disputes: Dispute[]; smsLog: SmsEntry[];
}

let _uidSeq = 0;
const uid = (p: string) => p + "-" + Date.now().toString(36) + (++_uidSeq).toString(36);
const mkTxId = () => {
  const d = new Date();
  return "SUSU-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + String(Math.floor(Math.random() * 900000) + 100000);
};
const fmt = (n: number, currency = "LRD") => currency + " " + Math.round(n).toLocaleString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

function mkMemberCode(name: string, memberCount: number): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  let initials = "";
  if (parts.length >= 2) {
    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } else if (parts.length === 1 && parts[0].length >= 2) {
    initials = parts[0].slice(0, 2).toUpperCase();
  } else if (parts.length === 1) {
    initials = (parts[0][0] + "X").toUpperCase();
  } else {
    initials = "MB";
  }
  const seq = 100 + memberCount;
  return `${initials}${seq}`;
}

function getMemberCode(m: Member, index?: number): string {
  if (m.memberCode) return m.memberCode;
  return mkMemberCode(m.name, index ?? (m.payoutPosition ? m.payoutPosition - 1 : 0));
}

function validateLiberiaPhone(rawPhone: string): { valid: boolean; formatted: string; error?: string } {
  const cleaned = rawPhone.replace(/[^\d+]/g, "");
  
  if (!cleaned) {
    return { valid: false, formatted: "", error: "Phone number is required." };
  }

  let digits = cleaned;
  if (digits.startsWith("+231")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("231")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Accepts 8 or 9 digits after 0/+231 (total 9 to 10 digits when starting with 0)
  if (digits.length !== 8 && digits.length !== 9) {
    return {
      valid: false,
      formatted: rawPhone,
      error: `Liberia standard phone number must be 10 digits starting with 0 (e.g. 0886123456) or 8-9 digits after +231. Current: ${rawPhone.length} chars.`,
    };
  }

  const carrier = digits.slice(0, 2);
  const middle = digits.slice(2, 5);
  const end = digits.slice(5);
  const formatted = `+231 ${carrier} ${middle} ${end}`;

  return { valid: true, formatted };
}

function fmtTimestamp(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}
function fmtDateOnly(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(ts: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function parseDateLocal(dateStr?: string): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.slice(0, 10).split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d);
    }
  }
  return new Date(dateStr);
}

function periodsElapsed(startDateStr: string, frequency = "Daily", asOfStr?: string): number {
  const sDate = parseDateLocal(startDateStr);
  const eDate = asOfStr ? parseDateLocal(asOfStr) : new Date();
  sDate.setHours(0, 0, 0, 0);
  eDate.setHours(0, 0, 0, 0);
  
  const diffDays = Math.max(Math.floor((eDate.getTime() - sDate.getTime()) / 86400000) + 1, 0);
  if (diffDays <= 0) return 0;
  
  if (frequency === "Weekly") {
    return Math.max(Math.floor((diffDays - 1) / 7) + 1, 1);
  } else if (frequency === "Monthly") {
    const months = (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
    return Math.max(months + 1, 1);
  }
  return diffDays;
}

function advanceDate(dateStr: string, frequency = "Daily"): string {
  const d = parseDateLocal(dateStr);
  if (frequency === "Weekly") {
    d.setDate(d.getDate() + 7);
  } else if (frequency === "Monthly") {
    d.setMonth(d.getMonth() + 1);
  } else {
    d.setDate(d.getDate() + 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function totalCyclePeriods(g: Group): number | null {
  if (!g.endDate) return null;
  return periodsElapsed(g.startDate, g.frequency, g.endDate);
}

// SMS content builder
function buildSmsContent(kind: string, member: Member, amount: number, g: Group, extra = ""): string {
  const ts = fmtTimestamp(nowISO());
  if (kind === "Receipt")
    return `SUSU RECEIPT\nDate: ${ts}\nGroup: ${g.name}\nMember: ${member.name}\nAmount paid: ${fmt(amount, g.currency)}\nRef: ${mkTxId()}\nThank you for your payment.`;
  if (kind === "Arrears receipt")
    return `SUSU ARREARS PAYMENT\nDate: ${ts}\nGroup: ${g.name}\nMember: ${member.name}\nAmount paid: ${fmt(amount, g.currency)}\nYour outstanding balance has been updated.\nRef: ${mkTxId()}`;
  if (kind === "Payment reminder")
    return `SUSU REMINDER\nDate: ${ts}\nGroup: ${g.name}\nDear ${member.name},\nYou have an outstanding balance of ${fmt(amount, g.currency)}.\nPlease settle at your earliest convenience.`;
  if (kind === "Payout confirmation")
    return `SUSU PAYOUT\nDate: ${ts}\nGroup: ${g.name}\nDear ${member.name},\nYour payout of ${fmt(amount, g.currency)} has been recorded.\n${extra}\nThank you for being part of our savings group.`;
  if (kind === "Collector fee")
    return `SUSU COLLECTOR FEE\nDate: ${ts}\nGroup: ${g.name}\nCollector fee recorded: ${fmt(amount, g.currency)}\nRef: ${mkTxId()}`;
  return `SUSU · ${g.name}\nDate: ${ts}\n${extra}`;
}
function mkSms(memberId: string, kind: string, content: string): SmsEntry {
  return { id: uid("sms"), memberId, kind, status: "Delivered", timestamp: nowISO(), content };
}


// ── Domain helpers ─────────────────────────────────────────────────────────────
function supersededMap(txs: Tx[]): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  txs.forEach((t) => { if (t.supersedes) m[t.supersedes] = true; });
  return m;
}

function getRootTxType(tx: Tx, allTx: Tx[]): string {
  if (tx.type !== "correction") return tx.type;
  const visited = new Set<string>([tx.id]);
  let curr: Tx | undefined = tx;
  while (curr && curr.type === "correction" && curr.supersedes) {
    if (visited.has(curr.supersedes)) break;
    visited.add(curr.supersedes);
    curr = allTx.find((x) => x.id === curr!.supersedes);
  }
  return curr && curr.type !== "correction" ? curr.type : "contribution";
}

function hasMemberPayout(state: AppState, memberId: string, groupId: string): boolean {
  const sup = supersededMap(state.transactions);
  return state.transactions.some((t) =>
    t.memberId === memberId &&
    t.groupId === groupId &&
    !sup[t.id] &&
    t.amount > 0 &&
    getRootTxType(t, state.transactions) === "payout"
  );
}

function allMembersPaidOut(state: AppState, groupId: string): boolean {
  const members = state.members.filter((m) => m.groupId === groupId);
  if (members.length === 0) return false;
  return members.every((m) => hasMemberPayout(state, m.id, groupId));
}

function isArrearsTx(t: Tx): boolean {
  return !!t.isArrears || (typeof t.note === "string" && t.note.toLowerCase().includes("arrears"));
}

function memberStats(state: AppState, m: Member) {
  const g = state.groups.find((gr) => gr.id === m.groupId);
  if (!g) {
    return { expected: 0, paid: 0, outstanding: 0, pastArrears: 0, status: "Not due", elapsed: 0, carried: 0, pastElapsed: 0, pastExpected: 0 };
  }
  const rawElapsed = periodsElapsed(g.startDate, g.frequency, g.virtualDate);
  const cp = totalCyclePeriods(g);
  // Cap elapsed to total cycle periods if endDate is defined
  const elapsed = cp !== null ? Math.min(rawElapsed, cp) : rawElapsed;

  const rosterDate = g.virtualDate || todayStr();
  const isCycleFinished = g.archived || (!!g.endDate && rosterDate > g.endDate) || allMembersPaidOut(state, g.id);

  // Completed past periods: if cycle is active, current period (rosterDate) is active, so past periods = max(0, elapsed - 1).
  // If cycle is finished, all elapsed periods are past completed periods.
  const pastElapsed = isCycleFinished ? elapsed : Math.max(0, elapsed - 1);

  const carried = state.rollovers.filter((r) => r.memberId === m.id && r.groupId === m.groupId).reduce((a, r) => a + r.amount, 0);
  const expected = g.amount * elapsed + carried;
  const pastExpected = g.amount * pastElapsed + carried;

  const sup = supersededMap(state.transactions);
  const paid = state.transactions
    .filter((t) => t.memberId === m.id && !sup[t.id] && getRootTxType(t, state.transactions) === "contribution")
    .reduce((a, t) => a + t.amount, 0);

  const outstanding = Math.max(0, expected - paid);
  const pastArrears = Math.max(0, pastExpected - paid);

  const status = paid >= expected && expected > 0 ? "Paid" : paid > 0 ? "Partial" : elapsed > 0 ? "Unpaid" : "Not due";
  return { expected, paid, outstanding, pastArrears, status, elapsed, carried, pastElapsed, pastExpected };
}

function groupTotals(state: AppState, gid: string) {
  const members = state.members.filter((m) => m.groupId === gid);
  const g = state.groups.find((gr) => gr.id === gid)!;
  const sup = supersededMap(state.transactions);

  // Contributions include regular contributions & corrections whose root transaction is a contribution
  const contributions = state.transactions
    .filter((t) => t.groupId === gid && !sup[t.id] && getRootTxType(t, state.transactions) === "contribution")
    .reduce((a, t) => a + t.amount, 0);

  // Outflows include payouts, collector fees & corrections whose root transaction is payout/collector_fee
  const payouts = state.transactions
    .filter((t) => {
      if (t.groupId !== gid || sup[t.id]) return false;
      const rootType = getRootTxType(t, state.transactions);
      return rootType === "payout" || rootType === "collector_fee";
    })
    .reduce((a, t) => a + t.amount, 0);

  let expected = 0, memberPaid = 0, pastArrears = 0;
  members.forEach((m) => {
    const s = memberStats(state, m);
    expected += s.expected;
    memberPaid += s.paid;
    pastArrears += s.pastArrears;
  });
  const outstanding = Math.max(0, expected - memberPaid);
  
  const contributingMembers = members.filter((m) => {
    return state.transactions.some((t) => t.memberId === m.id && !sup[t.id] && getRootTxType(t, state.transactions) === "contribution");
  }).length;

  const commission = g.feeType === "percentage" && g.feeValue > 0
    ? contributingMembers * g.amount
    : ((g.feeType as string) === "fixed" ? (g.feeValue || 0) : 0);
  
  // COLLECTION POT BALANCE = TOTAL CONTRIBUTIONS IN - TOTAL OUTFLOWS DISBURSED (PAYOUTS & FEES)
  const balance = Math.max(0, contributions - payouts);

  // full-cycle expected if endDate known
  const cp = totalCyclePeriods(g);
  const fullCycleExpected = cp !== null ? members.length * g.amount * cp : expected;
  return { expected, fullCycleExpected, contributions, payouts, outstanding, pastArrears, commission, balance, paid: memberPaid, hasEndDate: !!g.endDate };
}
// Per-member payout = their contributions minus 1 contribution unit collector fee
function memberPayout(state: AppState, m: Member): number {
  const g = state.groups.find((gr) => gr.id === m.groupId)!;
  const sup = supersededMap(state.transactions);
  const paid = state.transactions
    .filter((t) => t.memberId === m.id && !sup[t.id] && getRootTxType(t, state.transactions) === "contribution")
    .reduce((a, t) => a + t.amount, 0);
  if (paid <= 0) return 0;
  const fee = g.feeType === "percentage" && g.feeValue > 0 ? Math.min(paid, g.amount) : 0;
  return Math.max(0, paid - fee);
}
function payoutDate(g: Group): string | null {
  if (!g.endDate) return null;
  return advanceDate(g.endDate, g.frequency);
}

// ── Primitives ─────────────────────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl ${className}`}>{children}</div>;
}
function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: string }) {
  const c: Record<string, string> = { green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700", blue: "bg-blue-100 text-blue-700", gray: "bg-gray-100 text-gray-500", purple: "bg-purple-100 text-purple-700" };
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${c[color] || c.gray}`}>{children}</span>;
}
function PrimaryBtn({ children, onClick, disabled = false, className = "" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button onClick={onClick} disabled={disabled} className={`w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold text-sm py-3 rounded-xl active:bg-emerald-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all ${className}`}>{children}</button>;
}
function GhostBtn({ children, onClick, disabled = false, className = "" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button onClick={onClick} disabled={disabled} className={`w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-700 font-medium text-sm py-3 rounded-xl active:bg-gray-200 active:scale-[0.98] disabled:opacity-40 transition-all ${className}`}>{children}</button>;
}
function InlineTab({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all ${active === t ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>{t}</button>
      ))}
    </div>
  );
}
function FieldWrap({ label, error, required = false, optional = false, children }: { label: string; error?: string; required?: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-gray-600 flex items-center gap-0.5">
          <span>{label}</span>
          {required && <span className="text-red-500 font-bold ml-0.5" title="Required field">*</span>}
        </p>
        {optional && <span className="text-[10px] text-gray-400 font-normal">(Optional)</span>}
      </div>
      {children}
      {error && <p className="text-xs text-red-500 mt-1 font-medium">{error}</p>}
    </div>
  );
}
function Inp({ value, onChange, placeholder, type = "text", required = false, min, max, step, disabled = false }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; min?: number | string; max?: number | string; step?: number | string; disabled?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-3 py-2.5 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}
function Sel({ value, onChange, children, required = false, disabled = false }: { value: string; onChange: (v: string) => void; children: React.ReactNode; required?: boolean; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </select>
  );
}
function Toast({ msg }: { msg: string }) {
  return <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm p-3 rounded-xl mt-3"><CheckIcon className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{msg}</span></div>;
}
function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${done ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-500"}`}>
      {done ? <CheckIcon className="w-3 h-3" /> : n}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function CheckIcon({ className = "w-5 h-5" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="20 6 9 17 4 12"/></svg>;
}
function NavIcon({ name, active }: { name: string; active: boolean }) {
  const cls = `w-5 h-5 ${active ? "text-emerald-600" : "text-gray-400"}`;
  if (name === "today") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
  if (name === "collect") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
  if (name === "members") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (name === "finance") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
  if (name === "admin") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>;
  return null;
}

// ── Live clock hook ────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── No-group screen ────────────────────────────────────────────────────────────
function NoGroupScreen({ onGoAdmin }: { onGoAdmin: () => void }) {
  const now = useClock();
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
      <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center">
        <span className="text-3xl">💰</span>
      </div>
      <div>
        <p className="text-base font-semibold text-gray-800">No savings group yet</p>
        <p className="text-xs text-gray-400 mt-1">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>
      <p className="text-sm text-gray-500">Create your first group in Admin to get started.</p>
      <button onClick={onGoAdmin} className="bg-emerald-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl active:bg-emerald-700 transition-all">Go to Admin</button>
    </div>
  );
}

// ── TODAY TAB ──────────────────────────────────────────────────────────────────
function TodayTab({ state, setState, goCollect, goFinance }: {
  state: AppState; setState: (s: AppState) => void;
  goCollect: (sub: string) => void; goFinance: (sub: string) => void;
}) {
  const now = useClock();
  const g = state.groups.find((gr) => gr.id === state.activeGroupId && !gr.archived) || state.groups.find((gr) => !gr.archived) || state.groups[0];
  if (!g) {
    return (
      <Card className="p-8 text-center space-y-3 md:max-w-md md:mx-auto">
        <img src="/logo.png" alt="SusuBook Logo" className="w-16 h-16 object-contain mx-auto mb-1" />
        <p className="text-base font-semibold text-gray-800">Welcome to SusuBook</p>
        <p className="text-xs text-gray-500">Create your first savings group in Admin to start collecting contributions.</p>
      </Card>
    );
  }
  const t = groupTotals(state, g.id);
  const members = state.members.filter((m) => m.groupId === g.id);
  const rosterDate = g.virtualDate || todayStr();
  const isCycleEnded = g.archived || (!!g.endDate && rosterDate > g.endDate) || allMembersPaidOut(state, g.id);
  const sup = supersededMap(state.transactions);
  const collectedToday = members.filter((m) =>
    state.transactions.some(
      (tx) =>
        tx.memberId === m.id &&
        tx.date === rosterDate &&
        !sup[tx.id] &&
        !isArrearsTx(tx) &&
        tx.groupId === g.id &&
        getRootTxType(tx, state.transactions) === "contribution"
    )
  ).length;
  const rosterDone = collectedToday === members.length && members.length > 0;
  const arrearsList = members.filter((m) => memberStats(state, m).pastArrears > 0);
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length;
  const rate = t.fullCycleExpected > 0 ? Math.min(100, Math.round((t.contributions / t.fullCycleExpected) * 100)) : 0;

  const steps = [
    {
      n: 1,
      label: "Collect today's contributions",
      sub: isCycleEnded
        ? `Savings cycle ended ${g.endDate ? `on ${g.endDate}` : "· All members paid out"} · Roster closed`
        : members.length === 0
        ? "No members added yet — add members in Members tab first"
        : rosterDone
        ? `All ${members.length} members collected`
        : `${collectedToday} of ${members.length} collected`,
      done: rosterDone || isCycleEnded,
      action: () => { if (!isCycleEnded && members.length > 0) goCollect("Roster"); },
      actionLabel: isCycleEnded ? "Roster closed" : rosterDone ? "View roster" : "Open roster",
      disabled: isCycleEnded || members.length === 0,
    },
    { n: 2, label: "Check for past cycle arrears", sub: arrearsList.length > 0 ? `${arrearsList.length} member${arrearsList.length > 1 ? "s" : ""} have past arrears` : "No past arrears right now", done: arrearsList.length === 0, action: () => goFinance("Arrears"), actionLabel: "View arrears", disabled: false },
  ];

  return (
    <div className="space-y-4">
      {/* Date + time */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          <p className="text-xs text-gray-400">{now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}</p>
        </div>
        {state.groups.length > 1 && (
          <select value={state.activeGroupId} onChange={(e) => setState({ ...state, activeGroupId: e.target.value })} className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none">
            {state.groups.filter((gr) => !gr.archived).map((gr) => <option key={gr.id} value={gr.id}>{gr.name}</option>)}
          </select>
        )}
      </div>

      {isCycleEnded && (
        <Card className="p-3.5 bg-purple-50 border border-purple-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🔒</span>
            <div>
              <p className="text-xs font-bold text-purple-900">Savings Cycle Ended {g.endDate ? `(${g.endDate})` : "(All Members Paid Out)"}</p>
              <p className="text-[11px] text-purple-700">The final roster was closed. New collections are unclickable.</p>
            </div>
          </div>
          <button onClick={() => goFinance("Payouts")} className="text-xs font-bold px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all flex-shrink-0 ml-2">
            View Payouts
          </button>
        </Card>
      )}

      {/* Hero dashboard */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 text-white">
          <p className="text-xs font-medium opacity-70 mb-0.5">{g.name} · Cycle {g.cycleNumber}</p>
          <p className="text-3xl font-bold tracking-tight">{fmt(t.balance, g.currency)}</p>
          <p className="text-xs opacity-70 mt-0.5">collection pot balance</p>

          {/* Progress bar — entire cycle */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs opacity-70">{t.hasEndDate ? "Full cycle progress" : "Running progress"}</span>
              <span className="text-xs font-bold">{rate}%</span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-2">
              <div className="bg-white h-2 rounded-full transition-all" style={{ width: `${rate}%` }} />
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs opacity-60">{t.hasEndDate ? "Full cycle expected" : "Running expected"}</p>
              <p className="text-sm font-semibold">{fmt(t.fullCycleExpected, g.currency)}</p>
            </div>
            <div>
              <p className="text-xs opacity-60">Outstanding</p>
              <p className={`text-sm font-semibold ${t.outstanding > 0 ? "text-amber-200" : ""}`}>{fmt(t.outstanding, g.currency)}</p>
            </div>
          </div>
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          {[
            { label: "Members", val: `${members.length}` },
            { label: "Total in", val: fmt(t.contributions, g.currency) },
            { label: "Paid out", val: fmt(t.payouts, g.currency) },
          ].map((s) => (
            <div key={s.label} className="p-3 text-center">
              <p className="text-xs text-gray-400 mb-0.5">{s.label}</p>
              <p className="text-sm font-semibold text-gray-800">{s.val}</p>
            </div>
          ))}
        </div>
      </Card>

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Today's workflow</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {/* Collector earnings — static calculation from fee % */}
        {g.feeType === "percentage" && g.feeValue > 0 && (
          <Card className="p-4 flex items-center justify-between border border-emerald-100">
            <div>
              <p className="text-xs text-gray-400">Your collector's earnings</p>
              <p className="text-xs text-gray-500 mt-0.5">1 contribution ({fmt(g.amount, g.currency)}) per member</p>
            </div>
            <p className="text-xl font-bold text-emerald-600">{fmt(t.commission, g.currency)}</p>
          </Card>
        )}

        {/* Alerts */}
        {openDisputes > 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <span className="text-amber-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-amber-700">{openDisputes} open dispute{openDisputes > 1 ? "s" : ""}</p>
              <p className="text-xs text-amber-600">Resolve before closing the cycle or making payouts</p>
            </div>
          </div>
        )}

        {/* Daily workflow */}
        {steps.map((step) => (
          <Card key={step.n} className={`border ${step.done ? "border-emerald-100" : "border-gray-100"}`}>
            <div className="flex items-center gap-3 p-4">
              <StepBadge n={step.n} done={step.done} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${step.done ? "text-gray-400 line-through" : "text-gray-800"}`}>{step.label}</p>
                <p className={`text-xs mt-0.5 ${step.done ? "text-gray-300" : "text-gray-400"}`}>{step.sub}</p>
              </div>
              <button
                onClick={step.action}
                disabled={step.disabled}
                className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  step.disabled
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : step.done
                    ? "bg-gray-100 text-gray-500"
                    : "bg-emerald-600 text-white active:bg-emerald-700"
                }`}
              >
                {step.actionLabel}
              </button>
            </div>
          </Card>
        ))}
        </div>
      </div>
    </div>
  );
}

// ── COLLECT TAB ────────────────────────────────────────────────────────────────
function CollectTab({ state, setState, initialSub = "Roster", goHome }: {
  state: AppState; setState: (s: AppState) => void; initialSub?: string; goHome: () => void;
}) {
  const [sub, setSub] = useState(initialSub);
  const g = state.groups.find((gr) => gr.id === state.activeGroupId && !gr.archived) || state.groups.find((gr) => !gr.archived) || state.groups[0];
  if (!g) {
    return (
      <Card className="p-8 text-center space-y-3 md:max-w-md md:mx-auto">
        <p className="text-sm font-semibold text-gray-800">No active group selected</p>
        <p className="text-xs text-gray-500">Please create or select an active savings group to record payments.</p>
      </Card>
    );
  }
  const members = state.members.filter((m) => m.groupId === g.id);

  const rosterDate = g.virtualDate || todayStr();
  const isCycleEnded = g.archived || (!!g.endDate && rosterDate > g.endDate) || allMembersPaidOut(state, g.id);
  const sup = supersededMap(state.transactions);
  const memberTodayPaid = (mid: string) => state.transactions
    .filter((t) =>
      t.memberId === mid &&
      t.groupId === g.id &&
      t.date === rosterDate &&
      !sup[t.id] &&
      !isArrearsTx(t) &&
      getRootTxType(t, state.transactions) === "contribution"
    )
    .reduce((a, t) => a + t.amount, 0);

  const activeMembers = members.filter((m) => !hasMemberPayout(state, m.id, g.id));
  const collectedCount = activeMembers.filter((m) => memberTodayPaid(m.id) >= g.amount).length;

  // Day dashboard stats
  const todayExpected = activeMembers.length * g.amount;
  const todayCollected = state.transactions
    .filter((t) =>
      t.groupId === g.id &&
      t.date === rosterDate &&
      !sup[t.id] &&
      !isArrearsTx(t) &&
      getRootTxType(t, state.transactions) === "contribution"
    )
    .reduce((a, t) => a + t.amount, 0);
  const todayOutstanding = Math.max(0, todayExpected - todayCollected);
  const dayRate = todayExpected > 0 ? Math.min(100, Math.round((todayCollected / todayExpected) * 100)) : 100;

  const [rosterToast, setRosterToast] = useState<string | null>(null);

  const tapRoster = (memberId: string) => {
    if (isCycleEnded) return;
    if (hasMemberPayout(state, memberId, g.id)) {
      setRosterToast("Member has already been paid out. Contributions locked.");
      setTimeout(() => setRosterToast(null), 3000);
      return;
    }
    const alreadyPaidToday = memberTodayPaid(memberId);
    const remAmt = Math.max(0, g.amount - alreadyPaidToday);
    if (remAmt <= 0) {
      setRosterToast("Member has already fully paid today's contribution.");
      setTimeout(() => setRosterToast(null), 3000);
      return;
    }
    const recId = mkTxId();
    const ts = nowISO();
    const newTx: Tx = {
      id: uid("t"),
      groupId: g.id,
      memberId,
      type: "contribution",
      amount: remAmt,
      date: rosterDate,
      timestamp: ts,
      method: "Cash",
      note: alreadyPaidToday > 0 ? "Rapid roster (remaining)" : "Rapid roster",
      displayId: recId
    };
    const m = members.find((x) => x.id === memberId)!;
    const content = buildSmsContent("Receipt", m, remAmt, g);
    const sms = mkSms(memberId, "Receipt", content);
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setRosterToast(`Receipt for ${fmt(remAmt, g.currency)} sent to ${m.name} · ${m.phone}`);
    setTimeout(() => setRosterToast(null), 3000);
  };

  const periodLabel = g.frequency === "Weekly" ? "Week" : g.frequency === "Monthly" ? "Month" : "Day";

  const closePeriod = () => {
    if (isCycleEnded) return;
    const nextDate = advanceDate(rosterDate, g.frequency);
    setState({ ...state, groups: state.groups.map((gr) => gr.id === g.id ? { ...gr, virtualDate: nextDate } : gr) });
    goHome();
  };

  const [payMember, setPayMember] = useState(members[0]?.id || "");
  const [payAmt, setPayAmt] = useState(String(g.amount));
  const [payMethod, setPayMethod] = useState("Cash");
  const [payNote, setPayNote] = useState("");
  const [payErr, setPayErr] = useState("");
  const [payConfirm, setPayConfirm] = useState("");

  const recordPayment = () => {
    if (isCycleEnded) { setPayErr("Savings cycle has ended. Roster is closed."); return; }
    if (hasMemberPayout(state, payMember, g.id)) { setPayErr("Member has already been paid out. Contributions locked."); return; }
    const amt = parseFloat(payAmt);
    if (!amt || amt <= 0) { setPayErr("Enter an amount greater than 0."); return; }
    setPayErr("");
    const recId = mkTxId();
    const ts = nowISO();
    const isArrears = payNote.toLowerCase().includes("arrears");
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId: payMember, type: "contribution", amount: amt, date: rosterDate, timestamp: ts, method: payMethod, note: payNote || "Record Payment", isArrears, displayId: recId };
    const m = members.find((x) => x.id === payMember)!;
    const content = buildSmsContent(isArrears ? "Arrears receipt" : "Receipt", m, amt, g);
    const sms = mkSms(payMember, isArrears ? "Arrears receipt" : "Receipt", content);
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setPayConfirm(`Saved · ${recId} · SMS sent to ${m?.phone}`);
    setPayAmt(String(g.amount)); setPayNote("");
  };

  const candidates = state.transactions.filter((t) => t.groupId === g.id && (t.type === "contribution" || t.type === "correction") && !sup[t.id]);
  const [corrTx, setCorrTx] = useState(candidates[0]?.id || "");
  const [corrAmt, setCorrAmt] = useState(() => candidates[0] ? String(candidates[0].amount) : "");
  const [corrMemberName, setCorrMemberName] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const [corrErrors, setCorrErrors] = useState<Record<string, string>>({});
  const [corrConfirm, setCorrConfirm] = useState("");
  const origTx = candidates.find((t) => t.id === corrTx);
  const origMember = origTx ? state.members.find((m) => m.id === origTx.memberId) : null;

  const saveCorrection = () => {
    const errs: Record<string, string> = {};
    const amt = parseFloat(corrAmt);
    if (!amt || amt < 0) errs.amount = "Enter a valid amount.";
    if (!corrReason.trim()) errs.reason = "Explain why this is being corrected.";
    if (Object.keys(errs).length) { setCorrErrors(errs); return; }
    if (!origTx) return;
    const ts = nowISO();
    const newTx: Tx = { id: uid("t"), groupId: origTx.groupId, memberId: origTx.memberId, type: "correction", amount: amt, date: rosterDate, timestamp: ts, method: origTx.method, note: corrReason, supersedes: origTx.id, originalAmount: origTx.amount };
    // optionally update member name
    let members = state.members;
    if (corrMemberName.trim() && origMember && corrMemberName.trim() !== origMember.name) {
      members = state.members.map((m) => m.id === origMember.id ? { ...m, name: corrMemberName.trim() } : m);
    }
    setState({ ...state, transactions: [...state.transactions, newTx], members });
    setCorrConfirm(`Correction saved. Original ${fmt(origTx.amount, g.currency)} entry retained for audit.`);
    setCorrErrors({}); setCorrReason(""); setCorrMemberName("");
  };

  return (
    <div>
      <InlineTab tabs={["Roster", "Record Payment", "Correct Entry"]} active={sub} onChange={setSub} />

      {sub === "Roster" && (
        <div className="space-y-3 md:max-w-lg md:mx-auto">
          {isCycleEnded && (
            <Card className="p-3.5 bg-purple-50 border border-purple-200 text-purple-900 text-center space-y-1">
              <p className="text-xs font-bold flex items-center justify-center gap-1.5"><span>🔒</span> Savings Cycle Ended {g.endDate ? `(${g.endDate})` : "(All Members Paid Out)"}</p>
              <p className="text-[11px] text-purple-700">The final roster was closed. Tap-to-collect and roster advance are disabled.</p>
            </Card>
          )}

          {/* Collection period dashboard */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 text-white">
              <p className="text-xs opacity-70 mb-0.5">{g.name} ({g.frequency})</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{periodLabel} collection · {rosterDate}</p>
                <p className="text-xs font-bold opacity-90">{collectedCount}/{activeMembers.length} paid</p>
              </div>
              <div className="mt-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs opacity-70">This {periodLabel.toLowerCase()}'s progress</span>
                  <span className="text-xs font-bold">{dayRate}%</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-1.5">
                  <div className="bg-white h-1.5 rounded-full transition-all" style={{ width: `${dayRate}%` }} />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div><p className="text-xs opacity-60">Expected</p><p className="text-sm font-semibold">{fmt(todayExpected, g.currency)}</p></div>
                <div><p className="text-xs opacity-60">Collected</p><p className="text-sm font-semibold">{fmt(todayCollected, g.currency)}</p></div>
                <div><p className="text-xs opacity-60">Outstanding</p><p className={`text-sm font-semibold ${todayOutstanding > 0 ? "text-amber-200" : ""}`}>{fmt(todayOutstanding, g.currency)}</p></div>
              </div>
            </div>
          </Card>

          <p className="text-xs text-emerald-600 px-1">Tap each member to mark as paid — receipt SMS sent instantly.</p>

          {rosterToast && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs p-2.5 rounded-xl">
              <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{rosterToast}</span>
            </div>
          )}

          <Card>
            {members.map((m, i) => {
              const todayPaid = memberTodayPaid(m.id);
              const isDone = todayPaid >= g.amount;
              const isPartial = todayPaid > 0 && todayPaid < g.amount;
              const remAmt = Math.max(0, g.amount - todayPaid);
              const paidOut = hasMemberPayout(state, m.id, g.id);
              return (
                <div key={m.id} className={`flex items-center justify-between p-3.5 ${i < members.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{m.name}</p>
                    {paidOut ? (
                      <p className="text-xs text-purple-600 mt-0.5 font-medium">Paid Out · Contributions Locked</p>
                    ) : isDone ? (
                      <p className="text-xs text-emerald-500 mt-0.5">Fully collected ({fmt(todayPaid, g.currency)}) · SMS sent</p>
                    ) : isPartial ? (
                      <p className="text-xs text-amber-600 mt-0.5 font-semibold">Partial · {fmt(todayPaid, g.currency)} paid ({fmt(remAmt, g.currency)} remaining)</p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">Unpaid today</p>
                    )}
                  </div>
                  {paidOut ? (
                    <Badge color="purple">Paid Out</Badge>
                  ) : isDone ? (
                    <Badge color="green"><CheckIcon className="w-3 h-3" /> Done</Badge>
                  ) : isCycleEnded ? (
                    <Badge color="purple">Roster Closed</Badge>
                  ) : isPartial ? (
                    <button
                      onClick={() => tapRoster(m.id)}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg active:scale-[0.97] transition-all shadow-sm flex items-center gap-1"
                    >
                      Collect remaining ({fmt(remAmt, g.currency)})
                    </button>
                  ) : (
                    <button
                      onClick={() => tapRoster(m.id)}
                      className="bg-emerald-600 text-white text-xs font-bold px-4 py-1.5 rounded-lg active:bg-emerald-700 active:scale-[0.97] transition-all shadow-sm shadow-emerald-200"
                    >
                      Tap to collect
                    </button>
                  )}
                </div>
              );
            })}
            {members.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No members yet — add them in the Members tab.</p>}
          </Card>

          {/* Close Period — advances to next period based on frequency */}
          <button
            onClick={closePeriod}
            disabled={isCycleEnded}
            className={`w-full flex items-center justify-center gap-2 font-semibold text-sm py-3 rounded-xl transition-all ${
              isCycleEnded
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-gray-800 text-white active:bg-gray-900 active:scale-[0.98]"
            }`}
          >
            {isCycleEnded ? "Cycle Completed · Roster Closed" : `Close ${periodLabel} & Advance`}
          </button>
          {!isCycleEnded && collectedCount < members.length && members.length > 0 && (
            <p className="text-center text-xs text-gray-400">{members.length - collectedCount} member(s) not yet collected — you can still close.</p>
          )}
        </div>
      )}

      {sub === "Record Payment" && (
        <div className="space-y-3 md:max-w-lg md:mx-auto">
          {isCycleEnded ? (
            <Card className="p-3.5 bg-purple-50 border border-purple-200 text-purple-900 text-center space-y-1">
              <p className="text-xs font-bold flex items-center justify-center gap-1.5"><span>🔒</span> Savings Cycle Ended {g.endDate ? `(${g.endDate})` : "(All Members Paid Out)"}</p>
              <p className="text-[11px] text-purple-700">The final roster was closed. Recording new payments is disabled.</p>
            </Card>
          ) : (
            <Card className="p-3 bg-blue-50 border border-blue-100">
              <p className="text-xs text-blue-700 font-medium">Use for non-standard payments — different amounts, mobile money, or partial arrears. SMS receipt is sent automatically.</p>
            </Card>
          )}
          <Card className="p-4 space-y-0">
            <FieldWrap label="Member" required>
              <Sel
                value={payMember}
                onChange={(v) => {
                  setPayMember(v);
                  const paidToday = memberTodayPaid(v);
                  const rem = Math.max(0, g.amount - paidToday);
                  setPayAmt(String(rem > 0 ? rem : g.amount));
                }}
                disabled={isCycleEnded}
              >
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Sel>
            </FieldWrap>
            {memberTodayPaid(payMember) > 0 && Math.max(0, g.amount - memberTodayPaid(payMember)) > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-medium mb-3">
                Member paid {fmt(memberTodayPaid(payMember), g.currency)} today out of {fmt(g.amount, g.currency)}. Remaining balance for today is <strong>{fmt(Math.max(0, g.amount - memberTodayPaid(payMember)), g.currency)}</strong>.
              </div>
            )}
            <FieldWrap label={`Amount (${g.currency})`} error={payErr} required>
              <Inp value={payAmt} onChange={(v) => { setPayAmt(v); setPayErr(""); }} placeholder={String(g.amount)} type="number" min="1" disabled={isCycleEnded} required />
            </FieldWrap>
            <FieldWrap label="Payment method" required>
              <div className="flex gap-2">
                {["Cash", "MTN", "Orange"].map((m) => (
                  <button key={m} onClick={() => !isCycleEnded && setPayMethod(m)} disabled={isCycleEnded} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${payMethod === m ? "bg-emerald-600 text-white shadow-sm" : "bg-gray-100 text-gray-500"} ${isCycleEnded ? "opacity-50 cursor-not-allowed" : ""}`}>{m}</button>
                ))}
              </div>
            </FieldWrap>
            <FieldWrap label="Note" optional>
              <Inp value={payNote} onChange={setPayNote} placeholder="e.g. Partial arrears payment" disabled={isCycleEnded} />
            </FieldWrap>
            <PrimaryBtn onClick={recordPayment} disabled={isCycleEnded} className="mt-1">{isCycleEnded ? "Roster Closed" : "Save & send SMS"}</PrimaryBtn>
            {payConfirm && <Toast msg={payConfirm} />}
          </Card>
        </div>
      )}

      {sub === "Correct Entry" && (
        <div className="space-y-3 md:max-w-lg md:mx-auto">
          <Card className="p-3 bg-amber-50 border border-amber-100">
            <p className="text-xs text-amber-700 font-medium">Fix a recorded payment amount or correct a member name. Original entry is kept in the audit trail.</p>
          </Card>
          {candidates.length === 0
            ? <Card className="p-6 text-center"><p className="text-sm text-gray-400">No contribution entries to correct yet.</p></Card>
            : (
              <Card className="p-4 space-y-0">
                <FieldWrap label="Which payment to correct?" required>
                  <Sel value={corrTx} onChange={(id) => {
                    setCorrTx(id);
                    const t = candidates.find((x) => x.id === id);
                    if (t) {
                      setCorrAmt(String(t.amount));
                      const mem = state.members.find((x) => x.id === t.memberId);
                      setCorrMemberName(mem?.name || "");
                    }
                  }}>
                    {candidates.map((t) => { const m = state.members.find((x) => x.id === t.memberId); return <option key={t.id} value={t.id}>{m?.name} · {fmt(t.amount, g.currency)} · {t.date}</option>; })}
                  </Sel>
                </FieldWrap>
                {origTx && origMember && (
                  <div className="bg-gray-50 rounded-xl p-3 mb-3">
                    <p className="text-xs text-gray-400 mb-1">Original entry</p>
                    <p className="text-sm font-medium text-gray-700">{origMember.name} · {fmt(origTx.amount, g.currency)} · {origTx.date}</p>
                  </div>
                )}
                {/* Member name correction */}
                <FieldWrap label="Member name override" optional>
                  <Inp value={corrMemberName} onChange={setCorrMemberName} placeholder={origMember?.name || "Member name"} />
                </FieldWrap>
                <FieldWrap label={`Corrected amount (${g.currency})`} error={corrErrors.amount} required>
                  <Inp value={corrAmt} onChange={(v) => { setCorrAmt(v); setCorrErrors({ ...corrErrors, amount: "" }); }} type="number" min="0" required />
                </FieldWrap>
                <FieldWrap label="Reason for correction" error={corrErrors.reason} required>
                  <Inp value={corrReason} onChange={(v) => { setCorrReason(v); setCorrErrors({ ...corrErrors, reason: "" }); }} placeholder="e.g. Miscounted cash at collection" required />
                </FieldWrap>
                <PrimaryBtn onClick={saveCorrection} className="mt-1">Save correction</PrimaryBtn>
                {corrConfirm && <Toast msg={corrConfirm} />}
              </Card>
            )
          }
        </div>
      )}
    </div>
  );
}

// ── MEMBERS TAB ────────────────────────────────────────────────────────────────
function MembersTab({ state, setState }: { state: AppState; setState: (s: AppState) => void }) {
  const g = state.groups.find((gr) => gr.id === state.activeGroupId && !gr.archived) || state.groups.find((gr) => !gr.archived) || state.groups[0];
  if (!g) {
    return (
      <Card className="p-8 text-center space-y-3 md:max-w-md md:mx-auto">
        <p className="text-sm font-semibold text-gray-800">No active group selected</p>
        <p className="text-xs text-gray-500">Please create a savings group before adding members.</p>
      </Card>
    );
  }
  const members = state.members.filter((m) => m.groupId === g.id);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [cardMember, setCardMember] = useState<Member | null>(null);

  const confirmDelete = (mId: string) => {
    setState({
      ...state,
      members: state.members.filter((m) => m.id !== mId),
      transactions: state.transactions.filter((t) => t.memberId !== mId),
      disputes: state.disputes.filter((d) => d.memberId !== mId),
      rollovers: state.rollovers.filter((r) => r.memberId !== mId),
      smsLog: state.smsLog.filter((s) => s.memberId !== mId),
    });
    setDeleteConfirmId(null);
    if (editId === mId) setEditId(null);
  };

  const add = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Enter the member's full name.";
    
    const phoneVal = validateLiberiaPhone(phone);
    if (!phoneVal.valid) {
      errs.phone = phoneVal.error || "Enter a valid Liberian phone number.";
    }

    if (!address.trim()) errs.address = "Enter member's address / community.";

    if (Object.keys(errs).length) { setErrors(errs); return; }

    const code = mkMemberCode(name.trim(), members.length);
    const newMember: Member = {
      id: uid("m"),
      groupId: g.id,
      name: name.trim(),
      phone: phoneVal.formatted,
      address: address.trim(),
      memberCode: code,
      payoutPosition: members.length + 1,
    };

    setState({ ...state, members: [...state.members, newMember] });
    setName(""); setPhone(""); setAddress(""); setErrors({}); setShowAdd(false);
  };

  const openEdit = (m: Member) => {
    setEditId(m.id);
    setEditName(m.name);
    setEditPhone(m.phone);
    setEditAddress(m.address || "");
    setEditErrors({});
    setDeleteConfirmId(null);
  };

  const saveEdit = () => {
    const errs: Record<string, string> = {};
    if (!editName.trim()) errs.name = "Name cannot be empty.";
    
    const phoneVal = validateLiberiaPhone(editPhone);
    if (!phoneVal.valid) {
      errs.phone = phoneVal.error || "Enter a valid Liberian phone number.";
    }

    if (!editAddress.trim()) errs.address = "Address cannot be empty.";

    if (Object.keys(errs).length) { setEditErrors(errs); return; }

    setState({
      ...state,
      members: state.members.map((m) =>
        m.id === editId
          ? {
              ...m,
              name: editName.trim(),
              phone: phoneVal.formatted,
              address: editAddress.trim(),
              memberCode: m.memberCode || mkMemberCode(editName.trim(), (m.payoutPosition || 1) - 1),
            }
          : m
      ),
    });
    setEditId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{members.length} member{members.length !== 1 ? "s" : ""} · {g.name}</p>
        <button onClick={() => setShowAdd(!showAdd)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${showAdd ? "bg-gray-100 text-gray-500" : "bg-emerald-600 text-white"}`}>
          {showAdd ? "Cancel" : "+ Add member"}
        </button>
      </div>

      {showAdd && (
        <Card className="p-4 border border-emerald-100 md:max-w-lg space-y-0">
          <p className="text-sm font-semibold text-gray-800 mb-3">New member</p>
          <FieldWrap label="Full name" error={errors.name} required>
            <Inp value={name} onChange={(v) => { setName(v); setErrors({ ...errors, name: "" }); }} placeholder="e.g. Grace Weah" required />
          </FieldWrap>
          <FieldWrap label="Liberia phone (088 / 077 / +231)" error={errors.phone} required>
            <Inp value={phone} onChange={(v) => { setPhone(v); setErrors({ ...errors, phone: "" }); }} placeholder="0886123456 or +231 88 612 3456" type="tel" required />
          </FieldWrap>
          <FieldWrap label="Address / Community" error={errors.address} required>
            <Inp value={address} onChange={(v) => { setAddress(v); setErrors({ ...errors, address: "" }); }} placeholder="e.g. Red Light, Paynesville" required />
          </FieldWrap>
          <PrimaryBtn onClick={add} className="mt-1">Add to group</PrimaryBtn>
        </Card>
      )}

      {members.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-gray-400">No members yet.</p>
          <p className="text-xs text-gray-300 mt-1">Add your first member above.</p>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {members.map((m, idx) => {
          const code = getMemberCode(m, idx);
          return (
            <Card key={m.id} className="overflow-hidden">
              <div className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-mono font-bold text-xs rounded-md shadow-xs">{code}</span>
                      <p className="text-sm font-semibold text-gray-800 truncate">{m.name}</p>
                    </div>
                    <p className="text-xs text-gray-600 flex items-center gap-1">
                      <span>📞</span>
                      <span>{m.phone}</span>
                    </p>
                    {m.address && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <span>📍</span>
                        <span className="truncate">{m.address}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setCardMember(m)}
                      title="Generate & View Susu Card"
                      className="flex items-center justify-center px-2 py-1 gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold transition-all active:scale-95"
                    >
                      <span className="text-[11px]">📇</span>
                      <span>Card</span>
                    </button>
                    <button
                      onClick={() => editId === m.id ? setEditId(null) : openEdit(m)}
                      title="Edit member"
                      className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 text-gray-400 transition-all active:scale-95"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteConfirmId(deleteConfirmId === m.id ? null : m.id);
                        if (editId === m.id) setEditId(null);
                      }}
                      title="Delete member"
                      className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-400 transition-all active:scale-95"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </button>
                  </div>
                </div>
                {editId === m.id && (
                  <div className="pt-2 border-t border-gray-100 space-y-2">
                    <p className="text-xs font-semibold text-emerald-800">Edit member</p>
                    <FieldWrap label="Full name" error={editErrors.name} required>
                      <Inp value={editName} onChange={(v) => { setEditName(v); setEditErrors({ ...editErrors, name: "" }); }} required />
                    </FieldWrap>
                    <FieldWrap label="Liberia phone (088 / 077 / +231)" error={editErrors.phone} required>
                      <Inp value={editPhone} onChange={(v) => { setEditPhone(v); setEditErrors({ ...editErrors, phone: "" }); }} placeholder="0886123456 or +231 88 612 3456" type="tel" required />
                    </FieldWrap>
                    <FieldWrap label="Address / Community" error={editErrors.address} required>
                      <Inp value={editAddress} onChange={(v) => { setEditAddress(v); setEditErrors({ ...editErrors, address: "" }); }} placeholder="e.g. Red Light, Paynesville" required />
                    </FieldWrap>
                    <div className="flex items-center gap-2 pt-1">
                      <PrimaryBtn onClick={saveEdit} className="flex-1">Save</PrimaryBtn>
                      <GhostBtn onClick={() => setEditId(null)} className="flex-1">Cancel</GhostBtn>
                      <button
                        type="button"
                        onClick={() => { setEditId(null); setCardMember(m); }}
                        className="px-2.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-all flex items-center gap-1"
                        title="Generate Susu Card"
                      >
                        <span>📇</span>
                        <span>Card</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditId(null); setDeleteConfirmId(m.id); }}
                        className="px-2.5 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-all"
                        title="Delete member"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                {deleteConfirmId === m.id && (
                  <div className="pt-2.5 border-t border-red-100 bg-red-50/70 p-2.5 rounded-lg space-y-2">
                    <div className="flex items-start gap-2 text-red-800">
                      <span className="text-sm">⚠️</span>
                      <div className="text-xs">
                        <p className="font-semibold text-red-900">Delete member "{m.name}"?</p>
                        <p className="text-red-700 text-[11px] mt-0.5">
                          This will permanently remove this member and their recorded activity from this group.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => confirmDelete(m.id)}
                        className="flex-1 text-xs font-semibold py-1.5 px-3 bg-red-600 text-white rounded-lg hover:bg-red-700 active:scale-95 transition-all shadow-xs"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="flex-1 text-xs font-semibold py-1.5 px-3 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 active:scale-95 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {cardMember && (
        <SusuCardModal
          member={cardMember}
          group={g}
          collectorName={state.collectorName}
          onClose={() => setCardMember(null)}
        />
      )}
    </div>
  );
}

// ── FINANCE TAB ────────────────────────────────────────────────────────────────
function FinanceTab({ state, setState, initialSub = "Arrears" }: { state: AppState; setState: (s: AppState) => void; initialSub?: string }) {
  const [sub, setSub] = useState(initialSub);
  const g = state.groups.find((gr) => gr.id === state.activeGroupId && !gr.archived) || state.groups.find((gr) => !gr.archived) || state.groups[0];
  if (!g) {
    return (
      <Card className="p-8 text-center space-y-3 md:max-w-md md:mx-auto">
        <p className="text-sm font-semibold text-gray-800">No active group selected</p>
        <p className="text-xs text-gray-500">Create a savings group to manage arrears, payouts, and financial totals.</p>
      </Card>
    );
  }
  const members = state.members.filter((m) => m.groupId === g.id);
  const t = groupTotals(state, g.id);

  // ── Arrears ──
  const arrearsList = members
    .map((m) => ({ m, s: memberStats(state, m) }))
    .filter((x) => x.s.pastArrears > 0)
    .sort((a, b) => b.s.pastArrears - a.s.pastArrears);
  const totalPastArrears = arrearsList.reduce((acc, x) => acc + x.s.pastArrears, 0);
  const [remindConfirm, setRemindConfirm] = useState("");
  const [arrearsToast, setArrearsToast] = useState("");

  const sendReminders = () => {
    const newSms = arrearsList.map((x) => {
      const content = buildSmsContent("Payment reminder", x.m, x.s.pastArrears, g);
      return mkSms(x.m.id, "Payment reminder", content);
    });
    setState({ ...state, smsLog: [...newSms, ...state.smsLog] });
    setRemindConfirm(`Reminder SMS sent to ${arrearsList.length} member(s).`);
  };

  const payArrearsFull = (memberId: string, amount: number) => {
    const m = members.find((x) => x.id === memberId)!;
    const ts = nowISO();
    const recId = mkTxId();
    const rosterDate = g.virtualDate || todayStr();
    const newTx: Tx = {
      id: uid("t"),
      groupId: g.id,
      memberId,
      type: "contribution",
      amount,
      date: rosterDate,
      timestamp: ts,
      method: "Cash",
      note: "Arrears payment (past cycle)",
      isArrears: true,
      displayId: recId
    };
    const content = buildSmsContent("Arrears receipt", m, amount, g);
    const sms = mkSms(memberId, "Arrears receipt", content);
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setArrearsToast(`${fmt(amount, g.currency)} past arrears recorded for ${m.name} · SMS sent`);
    setTimeout(() => setArrearsToast(""), 3500);
  };

  // ── Payouts ──
  const pd = payoutDate(g);
  const sup = supersededMap(state.transactions);
  const hasPayout = (memberId: string) => hasMemberPayout(state, memberId, g.id);
  const hasCollectorPayout = state.transactions.some((t) => t.type === "collector_fee" && t.groupId === g.id);
  const openDisputeMembers = new Set(state.disputes.filter((d) => d.groupId === g.id && d.status === "open").map((d) => d.memberId));
  const [poMethod, setPoMethod] = useState("Cash");
  const [poConfirm, setPoConfirm] = useState("");

  const recordPayout = (memberId: string, amount: number) => {
    if (isNaN(amount) || amount <= 0) {
      setPoConfirm("Cannot record payout: Payout amount must be greater than 0.");
      return;
    }
    if (amount > t.balance) {
      setPoConfirm(`Cannot record payout: Payout amount (${fmt(amount, g.currency)}) exceeds available pot balance (${fmt(t.balance, g.currency)}).`);
      return;
    }
    const m = members.find((x) => x.id === memberId)!;
    const ts = nowISO();
    const content = buildSmsContent("Payout confirmation", m, amount, g, `Payout date: ${pd}`);
    const sms = mkSms(memberId, "Payout confirmation", content);
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId, type: "payout", amount, date: ts.slice(0, 10), timestamp: ts, method: poMethod, note: `Member payout · ${pd}` };
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setPoConfirm(`Payout recorded for ${m.name} · SMS sent`);
  };

  const recordCollectorFee = () => {
    const ts = nowISO();
    const fakeM: Member = { id: "collector", groupId: g.id, name: state.collectorName, phone: "", payoutPosition: 0 };
    const content = buildSmsContent("Collector fee", fakeM, t.commission, g);
    const sms = mkSms("collector", "Collector fee", content);
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId: "collector", type: "collector_fee", amount: t.commission, date: ts.slice(0, 10), timestamp: ts, method: poMethod, note: "Collector fee payout" };
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setPoConfirm(`Collector fee of ${fmt(t.commission, g.currency)} recorded · SMS receipt generated`);
  };

  // ── Ledger ──
  const [ledType, setLedType] = useState("all");
  const [ledMethod, setLedMethod] = useState("all");
  const allGroupTx = state.transactions.filter((tx) => tx.groupId === g.id && !sup[tx.id]).sort((a, b) => (a.timestamp || a.date).localeCompare(b.timestamp || b.date));
  let running = 0;
  const withBalance = allGroupTx.map((tx) => {
    const rootType = getRootTxType(tx, state.transactions);
    if (rootType === "contribution") {
      running += tx.amount;
    } else if (rootType === "payout" || rootType === "collector_fee") {
      running -= tx.amount;
    }
    return { tx, runningBalance: running };
  });
  const ledRows = withBalance
    .filter(({ tx }) => (ledType === "all" || tx.type === ledType) && (ledMethod === "all" || tx.method === ledMethod))
    .reverse();

  return (
    <div>
      <InlineTab tabs={["Arrears", "Payouts", "Ledger"]} active={sub} onChange={setSub} />

      {/* ── Arrears ── */}
      {sub === "Arrears" && (
        <div className="space-y-3">
          <Card className={`p-4 flex items-center justify-between ${totalPastArrears > 0 ? "bg-red-50 border border-red-100" : "bg-emerald-50 border border-emerald-100"}`}>
            <div>
              <p className={`text-xs font-medium ${totalPastArrears > 0 ? "text-red-500" : "text-emerald-600"}`}>Total past cycle arrears</p>
              <p className={`text-xl font-bold ${totalPastArrears > 0 ? "text-red-700" : "text-emerald-700"}`}>{fmt(totalPastArrears, g.currency)}</p>
            </div>
            {totalPastArrears === 0 && <Badge color="green"><CheckIcon className="w-3 h-3" /> All paid up</Badge>}
          </Card>
          {arrearsToast && <Toast msg={arrearsToast} />}
          {arrearsList.length > 0 && (
            <>
              <Card className="p-3 bg-blue-50 border border-blue-100">
                <p className="text-xs text-blue-700 font-medium">Overdue balances from completed past cycles. Paying here settles past arrears only and does not collect today's active daily contribution.</p>
              </Card>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {arrearsList.map((x) => (
                  <Card key={x.m.id} className="p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{x.m.name}</p>
                        <p className="text-xs text-red-600 font-medium mt-0.5">{fmt(x.s.pastArrears, g.currency)} arrears ({x.s.pastElapsed} past cycle{x.s.pastElapsed > 1 ? "s" : ""})</p>
                      </div>
                      <button
                        onClick={() => payArrearsFull(x.m.id, x.s.pastArrears)}
                        className="text-xs font-semibold text-white bg-emerald-600 px-3 py-1.5 rounded-lg active:bg-emerald-700 transition-all flex-shrink-0"
                      >
                        Pay in full · {fmt(x.s.pastArrears, g.currency)}
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
              <GhostBtn onClick={sendReminders}>Send reminder SMS to {arrearsList.length} member{arrearsList.length > 1 ? "s" : ""}</GhostBtn>
              {remindConfirm && <Toast msg={remindConfirm} />}
            </>
          )}
          {arrearsList.length === 0 && <Card className="p-6 text-center"><p className="text-sm text-gray-400">No past cycle arrears right now.</p></Card>}
        </div>
      )}

      {/* ── Payouts ── */}
      {sub === "Payouts" && (
        <div className="space-y-3">
          {/* Payout date banner */}
          <Card className={`p-3.5 ${pd ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-gray-100"}`}>
            <p className="text-xs font-semibold text-gray-600">Payout date</p>
            <p className={`text-base font-bold mt-0.5 ${pd ? "text-blue-700" : "text-gray-400"}`}>
              {pd ? fmtDateOnly(pd + "T00:00:00") : "Set group end date in Admin to calculate"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">One day after the susu group ends · each member receives what they contributed minus the collector fee</p>
          </Card>

          {/* Payment method */}
          <FieldWrap label="Payout method">
            <div className="flex gap-2">
              {["Cash", "MTN", "Orange"].map((m) => (
                <button key={m} onClick={() => setPoMethod(m)} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${poMethod === m ? "bg-emerald-600 text-white shadow-sm" : "bg-gray-100 text-gray-500"}`}>{m}</button>
              ))}
            </div>
          </FieldWrap>

          {/* Members payout list */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {members.map((m) => {
              const amount = memberPayout(state, m);
              const paid = hasPayout(m.id);
              const hasDispute = openDisputeMembers.has(m.id);
              return (
                <Card key={m.id} className="p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800">{m.name}</p>
                        {hasDispute && <Badge color="amber">Open dispute</Badge>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">Payout: {fmt(amount, g.currency)}</p>
                    </div>
                    {paid
                      ? <Badge color="green"><CheckIcon className="w-3 h-3" /> Paid</Badge>
                      : hasDispute
                        ? <span className="text-xs text-amber-600 font-medium">Resolve dispute first</span>
                        : amount <= 0
                          ? <span className="text-xs text-gray-400 font-medium">No payout due</span>
                          : <button onClick={() => recordPayout(m.id, amount)} disabled={amount <= 0 || amount > t.balance} className="text-xs font-semibold text-white bg-emerald-600 px-3 py-1.5 rounded-lg active:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all">Record payout</button>
                    }
                  </div>
                </Card>
              );
            })}
            {members.length === 0 && <Card className="p-4"><p className="text-sm text-gray-400 text-center">No members yet.</p></Card>}
          </div>

          {/* Collector's own fee payout */}
          {g.feeType === "percentage" && g.feeValue > 0 && (
            <Card className="p-4 border border-emerald-100">
              <p className="text-sm font-semibold text-gray-800 mb-0.5">Collector's fee — {state.collectorName}</p>
              <p className="text-xs text-gray-400 mb-3">1 contribution ({fmt(g.amount, g.currency)}) per member · {fmt(t.commission, g.currency)} earned</p>
              {hasCollectorPayout
                ? <Badge color="green"><CheckIcon className="w-3 h-3" /> Fee collected</Badge>
                : <PrimaryBtn onClick={recordCollectorFee}>Collect my fee — {fmt(t.commission, g.currency)}</PrimaryBtn>
              }
            </Card>
          )}

          {poConfirm && <Toast msg={poConfirm} />}
        </div>
      )}

      {/* ── Ledger ── */}
      {sub === "Ledger" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Sel value={ledType} onChange={setLedType}>
              <option value="all">All types</option>
              <option value="contribution">Contributions</option>
              <option value="correction">Corrections</option>
              <option value="payout">Payouts</option>
              <option value="collector_fee">Collector fee</option>
            </Sel>
            <Sel value={ledMethod} onChange={setLedMethod}>
              <option value="all">All methods</option>
              <option value="Cash">Cash</option>
              <option value="MTN">MTN</option>
              <option value="Orange">Orange</option>
            </Sel>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Total in", val: fmt(t.contributions, g.currency), color: "text-emerald-700 bg-emerald-50" },
              { label: "Paid out", val: fmt(t.payouts, g.currency), color: "text-red-600 bg-red-50" },
              { label: "Pot balance", val: fmt(t.balance, g.currency), color: "text-blue-700 bg-blue-50" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-2.5 text-center ${s.color}`}>
                <p className="text-xs opacity-70 mb-0.5">{s.label}</p>
                <p className="text-xs font-bold leading-tight">{s.val}</p>
              </div>
            ))}
          </div>
          <Card>
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-gray-100 bg-gray-50 rounded-t-2xl">
              <p className="text-xs font-semibold text-gray-400 flex-1">Member · type</p>
              <p className="text-xs font-semibold text-gray-400 w-28 text-right">Date &amp; time</p>
              <p className="text-xs font-semibold text-gray-400 w-20 text-right">Amount</p>
            </div>
            {ledRows.map(({ tx, runningBalance }, i) => {
              const m = state.members.find((x) => x.id === tx.memberId);
              const rootType = getRootTxType(tx, state.transactions);
              const isDebit = rootType === "payout" || rootType === "collector_fee";
              const isCorrection = tx.type === "correction";
              const name = tx.memberId === "collector" ? state.collectorName + " (fee)" : (m?.name || "?");
              return (
                <div key={tx.id} className={`px-3.5 py-3 ${i < ledRows.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{name}{isCorrection ? " (correction)" : isDebit ? " (payout)" : ""}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{fmtTimestamp(tx.timestamp || tx.date)} · {tx.method}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${isDebit ? "text-red-600" : "text-emerald-600"}`}>
                        {isDebit ? "−" : "+"}{fmt(tx.amount, g.currency)}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Bal: {fmt(runningBalance, g.currency)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {ledRows.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No transactions match this filter.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}

// ── ADMIN SUBS ─────────────────────────────────────────────────────────────────
function BackBtn({ onClick, label = "Admin" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-sm text-gray-500 font-medium mb-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>{label}
    </button>
  );
}

function ReconcileSub({ state, g, t, onBack }: { state: AppState; g: Group; t: ReturnType<typeof groupTotals>; onBack: () => void }) {
  const [subTab, setSubTab] = useState("Summary");
  const [txFilter, setTxFilter] = useState("all");
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<string | null>(null);

  const groupTxs = state.transactions.filter((x) => x.groupId === g.id);
  const corrections = groupTxs.filter((x) => x.type === "correction");
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open");
  const members = state.members.filter((m) => m.groupId === g.id);

  // Filtered ledger transactions
  const filteredTxs = groupTxs.filter((tx) => {
    if (txFilter === "contributions") return tx.type === "contribution";
    if (txFilter === "payouts") return tx.type === "payout";
    if (txFilter === "corrections") return tx.type === "correction";
    return true;
  });

  const runFullAudit = () => {
    setIsAuditing(true);
    setAuditResult(null);
    setTimeout(() => {
      setIsAuditing(false);
      const mathCheck = t.balance === Math.max(0, t.contributions - t.payouts);
      if (mathCheck && openDisputes.length === 0) {
        setAuditResult(`Audit Passed: All ${groupTxs.length} transactions and ${members.length} member balances verified. Pot balance (${fmt(t.balance, g.currency)}) matches double-entry credits/debits.`);
      } else if (openDisputes.length > 0) {
        setAuditResult(`Audit Flagged: ${openDisputes.length} open dispute(s) require resolution before cycle completion.`);
      } else {
        setAuditResult(`Audit Complete: Verified ${groupTxs.length} entries. No mathematical discrepancies detected.`);
      }
    }, 800);
  };

  const rows = [
    { label: "Total contributions collected (credits)", val: fmt(t.contributions, g.currency), type: "credit" },
    { label: "Total payouts issued (debits)", val: fmt(t.payouts, g.currency), type: "debit" },
    ...(t.commission > 0 ? [{ label: "Collector's commission fee", val: fmt(t.commission, g.currency), type: "fee" }] : []),
    { label: "Current collection pot balance", val: fmt(t.balance, g.currency), bold: true },
    { label: "Full cycle expected contributions", val: fmt(t.fullCycleExpected, g.currency) },
    { label: "Member outstanding arrears", val: fmt(t.outstanding, g.currency), alert: t.outstanding > 0 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <BackBtn onClick={onBack} />
        <button
          onClick={runFullAudit}
          disabled={isAuditing}
          className="text-xs font-bold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all active:scale-95 disabled:opacity-50"
        >
          {isAuditing ? "Auditing books..." : "🔍 Run Full Audit"}
        </button>
      </div>

      <div>
        <p className="text-base font-semibold text-gray-800">Server &amp; Ledger Reconciliation</p>
      </div>

      {auditResult && (
        <Card className={`p-3.5 border ${auditResult.includes("Passed") ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <span>{auditResult.includes("Passed") ? "✅" : "⚠️"}</span>
            <span>{auditResult}</span>
          </p>
        </Card>
      )}

      {/* Sub Tabs */}
      <InlineTab
        tabs={["Summary", "Ledger Audit Trail", "Member Status"]}
        active={subTab}
        onChange={setSubTab}
      />

      {subTab === "Summary" && (
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <div className="bg-gray-900 p-4 text-white">
              <p className="text-xs text-gray-400 mb-0.5">Double-entry Reconciliation · {g.name}</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold font-mono tracking-tight">{fmt(t.balance, g.currency)}</p>
                  <p className="text-xs text-emerald-400 mt-0.5">Reconciled pot balance</p>
                </div>
                <Badge color={openDisputes.length === 0 ? "green" : "amber"}>
                  {openDisputes.length === 0 ? "Books Balanced" : `${openDisputes.length} Dispute Flag`}
                </Badge>
              </div>
            </div>
            {rows.map((r, i) => (
              <div key={r.label} className={`flex justify-between items-center p-3.5 ${i < rows.length - 1 ? "border-b border-gray-50" : ""}`}>
                <p className={`text-sm ${r.bold ? "font-semibold text-gray-900" : "text-gray-600"}`}>{r.label}</p>
                <p className={`text-sm font-mono ${r.bold ? "font-bold text-emerald-700" : r.alert ? "font-semibold text-amber-600" : "text-gray-800"}`}>{r.val}</p>
              </div>
            ))}
          </Card>

          {(corrections.length > 0 || openDisputes.length > 0) ? (
            <Card className="p-3.5 bg-amber-50 border border-amber-200 space-y-1">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1">⚠️ Items Requiring Attention</p>
              {corrections.length > 0 && <p className="text-xs text-amber-700">· {corrections.length} audit correction(s) recorded in ledger.</p>}
              {openDisputes.length > 0 && <p className="text-xs text-amber-700">· {openDisputes.length} open dispute(s) pending resolution.</p>}
            </Card>
          ) : (
            <Card className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
              <CheckIcon className="w-4 h-4 flex-shrink-0 text-emerald-600" />
              <span>All double-entry calculations match. No flagged inconsistencies found.</span>
            </Card>
          )}
        </div>
      )}

      {subTab === "Ledger Audit Trail" && (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[
              { id: "all", label: `All (${groupTxs.length})` },
              { id: "contributions", label: "Contributions" },
              { id: "payouts", label: "Payouts" },
              { id: "corrections", label: "Corrections" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setTxFilter(f.id)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex-shrink-0 ${txFilter === f.id ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Card className="overflow-hidden">
            {filteredTxs.map((tx, idx) => {
              const m = state.members.find((x) => x.id === tx.memberId);
              const mName = tx.memberId === "collector" ? "Collector Fee" : m?.name || "Unknown";
              const mCode = m ? getMemberCode(m) : "";
              return (
                <div key={tx.id} className={`p-3.5 flex items-center justify-between ${idx < filteredTxs.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      {mCode && <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{mCode}</span>}
                      <p className="text-xs font-semibold text-gray-800 truncate">{mName}</p>
                      <Badge color={tx.type === "contribution" ? "green" : tx.type === "payout" ? "purple" : "amber"}>{tx.type}</Badge>
                    </div>
                    <p className="text-[11px] text-gray-400 font-mono truncate">{tx.displayId || tx.id} · {tx.date} · {tx.method}</p>
                    {tx.note && <p className="text-[11px] text-gray-500 italic truncate mt-0.5">"{tx.note}"</p>}
                  </div>
                  <p className={`text-xs font-mono font-bold flex-shrink-0 ${tx.type === "contribution" ? "text-emerald-600" : tx.type === "payout" ? "text-purple-600" : "text-amber-600"}`}>
                    {tx.type === "contribution" ? "+" : "-"}{fmt(tx.amount, g.currency)}
                  </p>
                </div>
              );
            })}
            {filteredTxs.length === 0 && (
              <p className="p-6 text-xs text-gray-400 text-center">No transaction records found for this filter.</p>
            )}
          </Card>
        </div>
      )}

      {subTab === "Member Status" && (
        <div className="space-y-3">
          <Card className="overflow-hidden">
            {members.map((m, idx) => {
              const ms = memberStats(state, m);
              const code = getMemberCode(m, idx);
              return (
                <div key={m.id} className={`p-3.5 flex items-center justify-between ${idx < members.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-xs font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">{code}</span>
                      <p className="text-xs font-semibold text-gray-800 truncate">{m.name}</p>
                    </div>
                    <p className="text-[11px] text-gray-400">Paid: {fmt(ms.paid, g.currency)} / {fmt(ms.expected, g.currency)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge color={ms.status === "Paid" ? "green" : ms.status === "Partial" ? "amber" : "red"}>{ms.status}</Badge>
                  </div>
                </div>
              );
            })}
            {members.length === 0 && (
              <p className="p-6 text-xs text-gray-400 text-center">No members found in this group.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function DisputesSub({ state, setState, g, onBack }: { state: AppState; setState: (s: AppState) => void; g: Group; onBack: () => void }) {
  const disputes = state.disputes.filter((d) => d.groupId === g.id);
  const members = state.members.filter((m) => m.groupId === g.id);
  const [dpMember, setDpMember] = useState(members[0]?.id || "");
  const [dpDesc, setDpDesc] = useState("");
  const [dpErr, setDpErr] = useState("");
  const resolve = (id: string) => setState({ ...state, disputes: state.disputes.map((d) => d.id === id ? { ...d, status: "resolved" } : d) });
  const addDispute = () => {
    if (!dpDesc.trim()) { setDpErr("Describe the dispute."); return; }
    setState({ ...state, disputes: [...state.disputes, { id: uid("d"), groupId: g.id, memberId: dpMember, description: dpDesc, status: "open" }] });
    setDpDesc(""); setDpErr("");
  };
  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">Disputes · {disputes.filter((d) => d.status === "open").length} open</p>
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {disputes.map((d, i) => {
          const m = state.members.find((x) => x.id === d.memberId);
          return (
            <div key={d.id} className={`p-3.5 ${i < disputes.length - 1 ? "border-b border-gray-50 md:border-b-0 md:odd:border-r" : ""} md:border-gray-50`}>
              <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold text-gray-800">{m?.name}</p><Badge color={d.status === "open" ? "amber" : "green"}>{d.status}</Badge></div>
              <p className="text-xs text-gray-500 mb-2">{d.description}</p>
              {d.status === "open" && <button onClick={() => resolve(d.id)} className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg active:bg-emerald-100">Mark resolved</button>}
            </div>
          );
        })}
        </div>
        {disputes.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No disputes yet.</p>}
      </Card>
      <Card className="p-4 md:max-w-lg">
        <p className="text-sm font-semibold text-gray-800 mb-3">Log a dispute</p>
        <FieldWrap label="Member" required><Sel value={dpMember} onChange={setDpMember}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Sel></FieldWrap>
        <FieldWrap label="Description" error={dpErr} required><Inp value={dpDesc} onChange={(v) => { setDpDesc(v); setDpErr(""); }} placeholder="What is being disputed?" required /></FieldWrap>
        <PrimaryBtn onClick={addDispute}>Log dispute</PrimaryBtn>
      </Card>
    </div>
  );
}

function CycleSub({ state, setState, g, t, onBack }: { state: AppState; setState: (s: AppState) => void; g: Group; t: ReturnType<typeof groupTotals>; onBack: () => void }) {
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length;
  const [cycleConfirm, setCycleConfirm] = useState("");
  const blocked = openDisputes > 0;

  const closeCycle = () => {
    // Archive the group — close the entire susu
    setState({
      ...state,
      groups: state.groups.map((gr) => gr.id === g.id
        ? { ...gr, archived: true, virtualDate: undefined }
        : gr
      ),
      // Set activeGroupId to next non-archived group if available
      activeGroupId: state.groups.find((gr) => gr.id !== g.id && !gr.archived)?.id || "",
    });
    setCycleConfirm(`"${g.name}" has been closed and archived. Records are preserved in the ledger.`);
  };

  const items = [
    {
      label: "No open disputes",
      pass: openDisputes === 0,
      detail: openDisputes === 0 ? "All disputes resolved." : `${openDisputes} dispute(s) still open — must resolve before closing`,
      soft: false,
    },
    {
      label: "Outstanding balances",
      pass: t.outstanding === 0,
      detail: t.outstanding === 0 ? "All members paid in full." : `${fmt(t.outstanding, g.currency)} outstanding — members receive only what they paid`,
      soft: true,
    },
  ];

  return (
    <div className="space-y-3 md:max-w-lg">
      <BackBtn onClick={onBack} />
      <p className="text-base font-semibold text-gray-800">Close &amp; Archive Cycle {g.cycleNumber}</p>
      <Card className="p-3 bg-amber-50 border border-amber-100">
        <p className="text-xs text-amber-700 font-medium">Closing archives the entire susu. All records are preserved. Each member's payout will reflect only what they contributed, minus the collector's fee.</p>
      </Card>
      <Card>
        {items.map((item, i) => {
          const color = item.pass ? "text-emerald-500" : item.soft ? "text-amber-500" : "text-red-500";
          return (
            <div key={item.label} className={`flex items-start gap-3 p-3.5 ${i < items.length - 1 ? "border-b border-gray-50" : ""}`}>
              <span className={`mt-0.5 ${color}`}>{item.pass ? <CheckIcon className="w-4 h-4" /> : item.soft ? <span className="text-sm">⚠</span> : <span className="text-sm">✕</span>}</span>
              <div><p className="text-sm font-medium text-gray-800">{item.label}</p><p className="text-xs text-gray-400 mt-0.5">{item.detail}</p></div>
            </div>
          );
        })}
      </Card>
      <PrimaryBtn onClick={closeCycle} disabled={blocked} className={blocked ? "" : "bg-red-600 active:bg-red-700"}>
        {blocked ? "Resolve open disputes first" : "Close &amp; Archive"}
      </PrimaryBtn>
      {cycleConfirm && <Toast msg={cycleConfirm} />}
    </div>
  );
}

function GroupsSub({ state, setState, onBack, goMembers }: { state: AppState; setState: (s: AppState) => void; onBack: () => void; goMembers: () => void }) {
  // New group form state
  const [gName, setGName] = useState("");
  const [gAmt, setGAmt] = useState("");
  const [gCur, setGCur] = useState("LRD");
  const [gFreq, setGFreq] = useState("Daily");
  const [gStart, setGStart] = useState(todayStr());
  const [gEnd, setGEnd] = useState("");
  const [feePercent, setFeePercent] = useState(0);
  const [gErrors, setGErrors] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Editing group modal state
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmt, setEditAmt] = useState("");
  const [editCur, setEditCur] = useState("LRD");
  const [editFreq, setEditFreq] = useState("Daily");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editFee, setEditFee] = useState(0);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // Deleting group modal state
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);

  const isGroupStarted = (gr: Group) => {
    const hasMembers = state.members.some((m) => m.groupId === gr.id);
    const hasTxs = state.transactions.some((t) => t.groupId === gr.id);
    return hasMembers || hasTxs;
  };

  const openEditModal = (gr: Group) => {
    setEditingGroup(gr);
    setEditName(gr.name);
    setEditAmt(String(gr.amount));
    setEditCur(gr.currency || "LRD");
    setEditFreq(gr.frequency || "Daily");
    setEditStart(gr.startDate || todayStr());
    setEditEnd(gr.endDate || "");
    setEditFee(gr.feeType === "percentage" ? (gr.feeValue || 0) : 0);
    setEditErrors({});
  };

  const unarchiveGroup = (gr: Group) => {
    setState({
      ...state,
      groups: state.groups.map((g) => (g.id === gr.id ? { ...g, archived: false } : g)),
      activeGroupId: gr.id,
    });
    setToastMsg(`Group "${gr.name}" unarchived and set as active.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const saveEditGroup = () => {
    if (!editingGroup) return;
    const errs: Record<string, string> = {};
    if (!editName.trim()) errs.name = "Group name is required.";
    const amt = parseFloat(editAmt);
    if (!amt || amt <= 0) errs.amount = "Enter a valid amount.";
    if (!editEnd) {
      errs.endDate = "Select an end date.";
    } else if (editEnd <= editStart) {
      errs.endDate = "End date must be after start date.";
    }
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }

    const updatedG: Group = {
      ...editingGroup,
      name: editName.trim(),
      amount: amt,
      currency: editCur,
      frequency: editFreq,
      startDate: editStart,
      endDate: editEnd,
      feeType: editFee > 0 ? "percentage" : "none",
      feeValue: editFee,
    };

    setState({
      ...state,
      groups: state.groups.map((g) => (g.id === editingGroup.id ? updatedG : g)),
    });

    setToastMsg(`Group "${updatedG.name}" updated successfully.`);
    setEditingGroup(null);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const confirmDeleteGroup = () => {
    if (!deletingGroup) return;
    const remainingGroups = state.groups.filter((g) => g.id !== deletingGroup.id);
    const newActiveId =
      state.activeGroupId === deletingGroup.id
        ? remainingGroups.find((g) => !g.archived)?.id || remainingGroups[0]?.id || ""
        : state.activeGroupId;

    setState({
      ...state,
      groups: remainingGroups,
      activeGroupId: newActiveId,
    });

    setToastMsg(`Group "${deletingGroup.name}" deleted.`);
    setDeletingGroup(null);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const createGroup = () => {
    const errs: Record<string, string> = {};
    if (!gName.trim()) errs.name = "Enter a group name.";
    const amt = parseFloat(gAmt);
    if (!amt || amt <= 0) errs.amount = "Enter a contribution amount.";
    if (!gStart) {
      errs.startDate = "Select a start date.";
    } else if (gStart < todayStr()) {
      errs.startDate = "Start date cannot be in the past.";
    }
    if (!gEnd) {
      errs.endDate = "Select an end date.";
    } else if (gEnd <= gStart) {
      errs.endDate = "End date must be after the start date.";
    }
    if (Object.keys(errs).length) { setGErrors(errs); return; }
    const ng: Group = {
      id: uid("g"), name: gName.trim(), amount: amt, currency: gCur,
      frequency: gFreq, cycles: 1, cycleNumber: 1, payoutOrder: "Fixed rotation",
      startDate: gStart || todayStr(), endDate: gEnd || undefined,
      feeType: feePercent > 0 ? "percentage" : "none", feeValue: feePercent,
    };
    setState({ ...state, groups: [...state.groups, ng], activeGroupId: ng.id });
    goMembers();
  };

  const activeGroups = state.groups.filter((g) => !g.archived);
  const archivedGroups = state.groups.filter((g) => g.archived);
  const isEditingGroupStarted = editingGroup ? isGroupStarted(editingGroup) : false;

  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">Groups</p>

      {toastMsg && <Toast msg={toastMsg} />}

      {activeGroups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeGroups.map((gr) => {
            const memberCount = state.members.filter((m) => m.groupId === gr.id).length;
            return (
              <Card key={gr.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{gr.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {memberCount} member{memberCount !== 1 ? "s" : ""} · {gr.frequency} · {fmt(gr.amount, gr.currency)} · cycle {gr.cycleNumber}{gr.endDate ? ` · ends ${gr.endDate}` : ""}
                    </p>
                  </div>
                  {gr.id === state.activeGroupId ? (
                    <Badge color="green">Active</Badge>
                  ) : (
                    <button onClick={() => setState({ ...state, activeGroupId: gr.id })} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">Switch</button>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100 text-xs">
                  <button
                    onClick={() => openEditModal(gr)}
                    className="flex items-center gap-1 font-semibold text-gray-700 hover:text-emerald-600 py-1 px-2.5 rounded-lg bg-gray-100 hover:bg-emerald-50 transition-all"
                  >
                    <span>✏️</span> Edit
                  </button>
                  <button
                    onClick={() => setDeletingGroup(gr)}
                    className="flex items-center gap-1 font-semibold text-red-600 hover:text-red-700 py-1 px-2.5 rounded-lg bg-red-50 hover:bg-red-100 transition-all ml-auto"
                  >
                    <span>🗑️</span> Delete
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {archivedGroups.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Archived</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {archivedGroups.map((gr) => (
              <Card key={gr.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">{gr.name}</p>
                    <p className="text-xs text-gray-300 mt-0.5">{state.members.filter((m) => m.groupId === gr.id).length} members · closed</p>
                  </div>
                  <Badge color="gray">Archived</Badge>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100 text-xs">
                  <button
                    onClick={() => unarchiveGroup(gr)}
                    className="flex items-center gap-1 font-semibold text-purple-700 hover:text-purple-800 py-1 px-2.5 rounded-lg bg-purple-50 hover:bg-purple-100 transition-all"
                  >
                    <span>🔓</span> Unarchive
                  </button>
                  <button
                    onClick={() => setDeletingGroup(gr)}
                    className="flex items-center gap-1 font-semibold text-red-600 hover:text-red-700 py-1 px-2.5 rounded-lg bg-red-50 hover:bg-red-100 transition-all ml-auto"
                  >
                    <span>🗑️</span> Delete
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-5 space-y-0 max-h-[90vh] overflow-y-auto bg-white shadow-2xl rounded-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
              <div>
                <p className="text-base font-bold text-gray-800">Edit Group Details</p>
                <p className="text-xs text-gray-400 mt-0.5">{editingGroup.name}</p>
              </div>
              <button onClick={() => setEditingGroup(null)} className="text-gray-400 hover:text-gray-600 font-bold text-lg p-1">✕</button>
            </div>

            {isEditingGroupStarted && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl font-medium mb-3">
                🔒 <strong>Group has already started / has members.</strong> Core settings (amount, frequency, currency, dates, fee) are locked to protect financial record authenticity, but you can update the group name.
              </div>
            )}

            {editingGroup.archived && (
              <div className="p-3 bg-purple-50 border border-purple-200 text-purple-900 text-xs rounded-xl font-medium mb-3">
                📁 <strong>Archived Group.</strong> This group is closed. You can edit its name, unarchive it, or delete it.
              </div>
            )}

            <FieldWrap label="Group name" error={editErrors.name} required>
              <Inp value={editName} onChange={(v) => { setEditName(v); setEditErrors({ ...editErrors, name: "" }); }} placeholder="e.g. Church Savings Group" required />
            </FieldWrap>

            <div className="flex gap-2">
              <div className="flex-1">
                <FieldWrap label={`Amount (${editCur})`} error={editErrors.amount} required>
                  <Inp
                    value={editAmt}
                    onChange={(v) => { setEditAmt(v); setEditErrors({ ...editErrors, amount: "" }); }}
                    placeholder="500"
                    type="number"
                    min="1"
                    disabled={isEditingGroupStarted}
                    required
                  />
                </FieldWrap>
              </div>
              <div className="w-24">
                <FieldWrap label="Currency" required>
                  <Sel value={editCur} onChange={setEditCur} disabled={isEditingGroupStarted}>
                    <option value="LRD">LRD</option>
                    <option value="USD">USD</option>
                  </Sel>
                </FieldWrap>
              </div>
            </div>

            <FieldWrap label="Frequency" required>
              <Sel value={editFreq} onChange={setEditFreq} disabled={isEditingGroupStarted}>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
              </Sel>
            </FieldWrap>

            <div className="flex gap-2">
              <div className="flex-1">
                <FieldWrap label="Start date" required>
                  <Inp type="date" value={editStart} onChange={setEditStart} disabled={isEditingGroupStarted} required />
                </FieldWrap>
              </div>
              <div className="flex-1">
                <FieldWrap label="End date" error={editErrors.endDate} required>
                  <Inp type="date" value={editEnd} onChange={(v) => { setEditEnd(v); setEditErrors({ ...editErrors, endDate: "" }); }} min={editStart} disabled={isEditingGroupStarted} required />
                </FieldWrap>
              </div>
            </div>

            <div className="mb-4">
              <FieldWrap label="Collector's fee">
                <Sel value={editFee > 0 ? "10" : "0"} onChange={(v) => setEditFee(Number(v))} disabled={isEditingGroupStarted}>
                  <option value="10">1 Contribution per member (Standard fee)</option>
                  <option value="0">No fee (0)</option>
                </Sel>
              </FieldWrap>
              {editFee > 0 && editAmt && (
                <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg p-2 mt-1.5 border border-emerald-100">
                  Collector earns 1 contribution unit ({editCur} {editAmt}) from each member for the cycle.
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <GhostBtn onClick={() => setEditingGroup(null)} className="flex-1">Cancel</GhostBtn>
              <PrimaryBtn onClick={saveEditGroup} className="flex-1">Save changes</PrimaryBtn>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Group Modal */}
      {deletingGroup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-5 space-y-3 bg-white shadow-2xl rounded-2xl text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto text-xl font-bold">🗑️</div>
            <div>
              <p className="text-base font-bold text-gray-800">Delete Savings Group?</p>
              <p className="text-xs text-gray-500 mt-1">
                Are you sure you want to delete <strong>"{deletingGroup.name}"</strong>? This will remove the group from your list.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setDeletingGroup(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteGroup}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-sm shadow-red-200"
              >
                Delete Group
              </button>
            </div>
          </Card>
        </div>
      )}

      <p className="text-sm font-semibold text-gray-700 pt-1">Create a new group</p>
      <Card className="p-4 space-y-0 md:max-w-lg">
        <FieldWrap label="Group name" error={gErrors.name} required>
          <Inp value={gName} onChange={(v) => { setGName(v); setGErrors({ ...gErrors, name: "" }); }} placeholder="e.g. Church Savings Group" required />
        </FieldWrap>
        <div className="flex gap-2">
          <div className="flex-1">
            <FieldWrap label={`Amount (${gCur})`} error={gErrors.amount} required>
              <Inp value={gAmt} onChange={(v) => { setGAmt(v); setGErrors({ ...gErrors, amount: "" }); }} placeholder="500" type="number" min="1" required />
            </FieldWrap>
          </div>
          <div className="w-24">
            <FieldWrap label="Currency" required>
              <Sel value={gCur} onChange={setGCur}>
                <option value="LRD">LRD</option>
                <option value="USD">USD</option>
              </Sel>
            </FieldWrap>
          </div>
        </div>
        <FieldWrap label="Frequency" required>
          <Sel value={gFreq} onChange={setGFreq}>
            <option value="Daily">Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
          </Sel>
        </FieldWrap>
        <div className="flex gap-2">
          <div className="flex-1">
            <FieldWrap label="Start date" error={gErrors.startDate} required>
              <Inp type="date" value={gStart} onChange={(v) => { setGStart(v); setGErrors({ ...gErrors, startDate: "" }); }} min={todayStr()} required />
            </FieldWrap>
          </div>
          <div className="flex-1">
            <FieldWrap label="End date" error={gErrors.endDate} required>
              <Inp type="date" value={gEnd} onChange={(v) => { setGEnd(v); setGErrors({ ...gErrors, endDate: "" }); }} min={gStart || todayStr()} required />
            </FieldWrap>
          </div>
        </div>
        <div className="mb-3 space-y-1">
          <FieldWrap label="Collector's fee">
            <Sel value={feePercent > 0 ? "10" : "0"} onChange={(v) => setFeePercent(Number(v))}>
              <option value="10">1 Contribution per member (Standard fee)</option>
              <option value="0">No fee (0)</option>
            </Sel>
          </FieldWrap>
          {feePercent > 0 && gAmt && (
            <p className="text-xs text-emerald-600 mt-1.5 bg-emerald-50 rounded-lg px-2.5 py-1.5 border border-emerald-100">
              Collector earns 1 contribution unit ({gCur} {gAmt}) from each member for the cycle.
            </p>
          )}
        </div>
        <PrimaryBtn onClick={createGroup} className="mt-1">Create group</PrimaryBtn>
      </Card>
    </div>
  );
}

// ── SMS Log ────────────────────────────────────────────────────────────────────
function SmsSub({ state, setState, onBack }: { state: AppState; setState: (s: AppState) => void; onBack: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = state.smsLog.slice(0, 60);
  const retry = (id: string) => setState({ ...state, smsLog: state.smsLog.map((s) => s.id === id ? { ...s, status: "Delivered" } : s) });
  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">SMS Log</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((s) => {
          const m = state.members.find((x) => x.id === s.memberId);
          const name = s.memberId === "collector" ? state.collectorName + " (collector)" : (m?.name || "?");
          return (
            <Card key={s.id} className="overflow-hidden">
              <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="w-full flex items-center justify-between p-3.5 text-left transition-colors hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.kind} · {fmtTimestamp(s.timestamp)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <Badge color={s.status === "Delivered" ? "green" : s.status === "Sent" ? "blue" : "red"}>{s.status}</Badge>
                  {s.status === "Failed" && <button onClick={(e) => { e.stopPropagation(); retry(s.id); }} className="text-xs font-semibold text-emerald-600">Retry</button>}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 text-gray-300 transition-transform ${openId === s.id ? "rotate-90" : ""}`}><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </button>
              {openId === s.id && (
                <div className="mx-3 mb-3 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Message content</p>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{s.content}</pre>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {list.length === 0 && <Card className="p-4"><p className="text-sm text-gray-400 text-center">No SMS activity yet.</p></Card>}
    </div>
  );
}

// ── ADMIN TAB ──────────────────────────────────────────────────────────────────
function AdminTab({ state, setState, goMembers }: { state: AppState; setState: (s: AppState) => void; goMembers: () => void }) {
  const [sub, setSub] = useState<string | null>(null);
  const activeGroup = state.groups.find((gr) => gr.id === state.activeGroupId && !gr.archived);
  const g = activeGroup || state.groups.find((gr) => !gr.archived);
  const t = g ? groupTotals(state, g.id) : null;

  if (sub === "Reconcile" && g && t) return <ReconcileSub state={state} g={g} t={t} onBack={() => setSub(null)} />;
  if (sub === "Disputes" && g) return <DisputesSub state={state} setState={setState} g={g} onBack={() => setSub(null)} />;
  if (sub === "Cycle" && g && t) return <CycleSub state={state} setState={setState} g={g} t={t} onBack={() => setSub(null)} />;
  if (sub === "Groups") return <GroupsSub state={state} setState={setState} onBack={() => setSub(null)} goMembers={goMembers} />;
  if (sub === "SMS") return <SmsSub state={state} setState={setState} onBack={() => setSub(null)} />;

  const adminItems = [
    { key: "Reconcile", label: "Reconciliation", sub: "Verify your books balance", icon: "⚖️", disabled: !g },
    { key: "Disputes", label: "Disputes", sub: "Log and resolve member disputes", icon: "💬", badge: g ? state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length : 0, disabled: !g },
    { key: "Cycle", label: "Close & Archive Cycle", sub: "End susu and archive all records", icon: "🔒", disabled: !g },
    { key: "Groups", label: "Groups", sub: "Manage or create savings groups", icon: "👥", disabled: false },
    { key: "SMS", label: "SMS Log", sub: "Message delivery history", icon: "📱", disabled: false },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Occasional tasks — run at the end of each cycle or as needed.</p>
      {!g && <Card className="p-4 text-center"><p className="text-sm text-gray-400">No active group. Create one in Groups.</p></Card>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {adminItems.map((item) => (
          <Card key={item.key}>
          <button onClick={() => !item.disabled && setSub(item.key)} disabled={item.disabled} className={`w-full flex items-center gap-3 p-4 text-left transition-colors ${item.disabled ? "opacity-40 cursor-not-allowed" : "active:bg-gray-50"}`}>
            <span className="text-xl w-8 text-center flex-shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                {item.badge ? <Badge color="amber">{item.badge}</Badge> : null}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{item.sub}</p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-gray-300 flex-shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── ROOT APP ───────────────────────────────────────────────────────────────────
interface AppProps {
  collectorName?: string;
}

export default function App({ collectorName = "Collector" }: AppProps) {
  const { signOut, collector } = useAuth();
  const dexieSync = useDexieSync();
  const { isOnline, isSyncing, pendingCount, processQueue } = dexieSync;
  
  // Fetch data from Supabase
  const { data: groups = [] } = useGroups();
  const { data: members = [] } = useMembers();
  const { data: transactions = [] } = useTransactions();
  const { data: rollovers = [] } = useRollovers();
  const { data: disputes = [] } = useDisputes();
  const { data: smsLog = [] } = useSmsLog();
  
  // Mutation hooks
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const createMember = useCreateMember();
  const updateMember = useUpdateMember();
  const createTransaction = useCreateTransaction();
  const createSmsEntry = useCreateSmsEntry();
  const createDispute = useCreateDispute();
  const updateDispute = useUpdateDispute();
  const createRollover = useCreateRollover();
  const deleteGroup = useDeleteGroup();
  const deleteMember = useDeleteMember();
  
  // Edge Function hooks for atomic financial operations
  const recordPayment = useRecordPayment();
  const recordCorrection = useRecordCorrection();
  const closeCycle = useCloseCycle();
  
  // Local state for UI
  const [activeGroupId, setActiveGroupId] = useState("");
  const [tab, setTab] = useState<NavTab>("today");
  const [collectSub, setCollectSub] = useState("Roster");
  const [financeSub, setFinanceSub] = useState("Arrears");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showMasterAdminModal, setShowMasterAdminModal] = useState(false);
  
  // Computed state matching the original AppState shape
  const state: AppState = {
    collectorName,
    activeGroupId,
    groups,
    members,
    transactions,
    rollovers,
    disputes,
    smsLog,
  };
  
  // setState wrapper that uses mutations with optimistic updates
  const setState = useCallback((newState: AppState) => {
    // Handle activeGroupId changes (local state only)
    if (newState.activeGroupId !== activeGroupId) {
      setActiveGroupId(newState.activeGroupId);
    }
    
    // Handle group additions (new groups created in Admin)
    if (newState.groups.length > state.groups.length) {
      const newGroups = newState.groups.filter(g => !state.groups.find(sg => sg.id === g.id));
      newGroups.forEach(g => {
        createGroup.mutate(g, {
          onSuccess: (result) => {
            if (result?.created?.id) {
              setActiveGroupId(result.created.id);
            }
          },
          onError: (error) => {
            console.error('Failed to create group:', error);
          }
        });
      });
    }
    
    // Handle group deletions
    if (newState.groups.length < state.groups.length) {
      const deletedGroups = state.groups.filter(sg => !newState.groups.find(g => g.id === sg.id));
      deletedGroups.forEach(g => {
        deleteGroup.mutate(g.id, {
          onError: (error) => {
            console.error('Failed to delete group:', error);
          }
        });
      });
    }

    // Handle group updates (name, amount, currency, frequency, feeValue, virtualDate, archived, etc.)
    newState.groups.forEach(newGroup => {
      const oldGroup = state.groups.find(g => g.id === newGroup.id);
      if (oldGroup && (
        newGroup.name !== oldGroup.name ||
        newGroup.amount !== oldGroup.amount ||
        newGroup.currency !== oldGroup.currency ||
        newGroup.frequency !== oldGroup.frequency ||
        newGroup.feeType !== oldGroup.feeType ||
        newGroup.feeValue !== oldGroup.feeValue ||
        newGroup.startDate !== oldGroup.startDate ||
        newGroup.endDate !== oldGroup.endDate ||
        newGroup.virtualDate !== oldGroup.virtualDate ||
        newGroup.archived !== oldGroup.archived ||
        newGroup.cycleNumber !== oldGroup.cycleNumber
      )) {
        // If group is being archived, use closeCycle Edge Function
        if (newGroup.archived && !oldGroup.archived) {
          closeCycle.mutate(newGroup.id, {
            onError: (error) => {
              console.error('Failed to close cycle:', error);
            }
          });
        } else {
          updateGroup.mutate({ id: newGroup.id, updates: newGroup }, {
            onError: (error) => {
              console.error('Failed to update group:', error);
            }
          });
        }
      }
    });
    
    // Handle member additions
    if (newState.members.length > state.members.length) {
      const newMembers = newState.members.filter(m => !state.members.find(sm => sm.id === m.id));
      newMembers.forEach(m => {
        createMember.mutate(m, {
          onError: (error) => {
            console.error('Failed to create member:', error);
          }
        });
      });
    }
    
    // Handle member deletions
    if (newState.members.length < state.members.length) {
      const deletedMembers = state.members.filter(sm => !newState.members.find(m => m.id === sm.id));
      deletedMembers.forEach(m => {
        deleteMember.mutate(m.id, {
          onError: (error) => {
            console.error('Failed to delete member:', error);
          }
        });
      });
    }

    // Handle member updates (name/phone changes)
    newState.members.forEach(newMember => {
      const oldMember = state.members.find(m => m.id === newMember.id);
      if (oldMember && (newMember.name !== oldMember.name || newMember.phone !== oldMember.phone)) {
        updateMember.mutate({ id: newMember.id, updates: newMember }, {
          onError: (error) => {
            console.error('Failed to update member:', error);
          }
        });
      }
    });
    
    // Handle transaction additions
    if (newState.transactions.length > state.transactions.length) {
      const newTxs = newState.transactions.filter(t => !state.transactions.find(st => st.id === t.id));
      newTxs.forEach(t => {
        // Skip transactions that were already created via optimistic updates
        if (t.id.startsWith('temp-')) return;
        
        if (t.type === "contribution") {
          recordPayment.mutate({
            groupId: t.groupId,
            memberId: t.memberId,
            amount: t.amount,
            date: t.date,
            method: t.method || "Cash",
            note: t.note || "Rapid roster",
            displayId: t.displayId || mkTxId(),
          }, {
            onError: (error) => {
              console.error('Failed to record payment:', error);
            }
          });
        } else if (t.type === "correction" && t.supersedes && t.originalAmount !== undefined) {
          recordCorrection.mutate({
            groupId: t.groupId,
            memberId: t.memberId,
            amount: t.amount,
            date: t.date,
            method: t.method || "Cash",
            note: t.note || "Correction",
            supersedes: t.supersedes,
            originalAmount: t.originalAmount,
          }, {
            onError: (error) => {
              console.error('Failed to record correction:', error);
            }
          });
        } else {
          // Use regular mutation for other transaction types (payouts, collector fees)
          createTransaction.mutate(t, {
            onError: (error) => {
              console.error('Failed to create transaction:', error);
            }
          });
        }
      });
    }
    
    // Handle SMS log additions & delivery
    if (newState.smsLog.length > state.smsLog.length) {
      const newSms = newState.smsLog.filter(s => !state.smsLog.find(ss => ss.id === s.id));
      newSms.forEach(s => {
        createSmsEntry.mutate(s, {
          onError: (error) => {
            console.error('Failed to create/send SMS entry:', error);
          }
        });
      });
    }
    
    // Handle dispute additions
    if (newState.disputes.length > state.disputes.length) {
      const newDisputes = newState.disputes.filter(d => !state.disputes.find(sd => sd.id === d.id));
      newDisputes.forEach(d => {
        createDispute.mutate(d, {
          onError: (error) => {
            console.error('Failed to create dispute:', error);
          }
        });
      });
    }
    
    // Handle dispute status updates
    newState.disputes.forEach(newDispute => {
      const oldDispute = state.disputes.find(d => d.id === newDispute.id);
      if (oldDispute && newDispute.status !== oldDispute.status) {
        updateDispute.mutate({ id: newDispute.id, updates: { status: newDispute.status } }, {
          onError: (error) => {
            console.error('Failed to update dispute:', error);
          }
        });
      }
    });
    
    // Handle rollover additions
    if (newState.rollovers.length > state.rollovers.length) {
      const newRollovers = newState.rollovers.filter(r => !state.rollovers.find(sr => sr.id === r.id));
      newRollovers.forEach(r => {
        createRollover.mutate(r, {
          onError: (error) => {
            console.error('Failed to create rollover:', error);
          }
        });
      });
    }
  }, [activeGroupId, state, createGroup, updateGroup, createMember, updateMember, deleteMember, createTransaction, createSmsEntry, createDispute, updateDispute, createRollover, recordPayment, recordCorrection, closeCycle]);
  
  const goCollect = (sub: string) => { setCollectSub(sub); setTab("collect"); };
  const goFinance = (sub: string) => { setFinanceSub(sub); setTab("finance"); };
  const goHome = () => setTab("today");

  const activeGroups = state.groups.filter((g) => !g.archived);
  const hasActiveGroup = activeGroups.length > 0;

  // Auto-select valid active group if activeGroupId is stale or un-synced
  useEffect(() => {
    if (activeGroups.length > 0) {
      const isValid = activeGroups.some((g) => g.id === activeGroupId);
      if (!isValid) {
        setActiveGroupId(activeGroups[0].id);
      }
    }
  }, [activeGroups, activeGroupId]);

  const tabLabel: Record<NavTab, string> = { today: "Home", collect: "Collect", members: "Members", finance: "Finance", admin: "Admin" };

  const renderTab = () => {
    if (!hasActiveGroup && tab !== "admin") return <NoGroupScreen onGoAdmin={() => setTab("admin")} />;
    switch (tab) {
      case "today": return <TodayTab state={state} setState={setState} goCollect={goCollect} goFinance={goFinance} />;
      case "collect": return <CollectTab key={collectSub} state={state} setState={setState} initialSub={collectSub} goHome={goHome} />;
      case "members": return <MembersTab state={state} setState={setState} />;
      case "finance": return <FinanceTab key={financeSub} state={state} setState={setState} initialSub={financeSub} />;
      case "admin": return <AdminTab state={state} setState={setState} goMembers={() => setTab("members")} />;
    }
  };

  return (
    <div className="relative h-full flex flex-col bg-gray-50 w-full max-w-md mx-auto md:max-w-2xl lg:max-w-none lg:mx-0">
      <header className="bg-white border-b border-gray-100 px-4 h-14 flex items-center gap-3 flex-shrink-0 md:pl-48 lg:px-8 lg:pl-56">
        <img src="/logo.png" alt="SusuBook Logo" className="w-7 h-7 object-contain rounded-lg flex-shrink-0" />
        <p className="text-sm font-semibold text-gray-800 flex-1">{tabLabel[tab]}</p>
        
        {/* Dexie Offline Sync Status Pill */}
        <div className="flex items-center gap-1.5">
          {isSyncing ? (
            <span className="flex items-center gap-1 bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded-full text-[11px] animate-pulse">
              <span>🔄</span> Syncing...
            </span>
          ) : !isOnline ? (
            <span className="flex items-center gap-1 bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full text-[11px]" title="Offline mode active — changes stored in Dexie IndexedDB">
              <span>⚡</span> Offline ({pendingCount} queued)
            </span>
          ) : pendingCount > 0 ? (
            <button onClick={() => processQueue()} className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full text-[11px] transition-all" title="Click to sync local queue to cloud">
              <span>🟡</span> {pendingCount} queued · Sync
            </button>
          ) : (
            <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 font-medium px-2 py-0.5 rounded-full text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Online</span>
            </span>
          )}
        </div>

        {collector?.is_super_admin === true && (
          <button
            onClick={() => setShowMasterAdminModal(true)}
            className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white font-medium px-2.5 py-1 rounded-full text-xs transition-all shadow-xs"
            title="Master Admin Command Center — Provisioning Keys & Platform Audit"
          >
            <span>🔐</span>
            <span className="hidden sm:inline font-semibold">Master Admin</span>
          </button>
        )}

        <button
          onClick={() => setShowProfileModal(true)}
          className="flex items-center space-x-2 bg-emerald-50/90 hover:bg-emerald-100 text-emerald-900 border border-emerald-200/80 font-semibold px-2.5 py-1 rounded-full text-xs transition-all shadow-xs"
          title="Click to view & edit Collector Profile"
        >
          {collector?.avatar_url ? (
            <img src={collector.avatar_url} alt={state.collectorName} className="w-5 h-5 rounded-full object-cover border border-emerald-400" />
          ) : (
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold">
              {state.collectorName.charAt(0).toUpperCase() || "👤"}
            </span>
          )}
          <span className="font-semibold text-emerald-800">{collector?.business_name || state.collectorName}</span>
          <span className="text-[10px] text-emerald-600">⚙️</span>
        </button>
        <button
          onClick={signOut}
          className="text-xs text-gray-400 hover:text-red-600 transition-colors"
          title="Sign out"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24 md:pl-48 md:pb-4 lg:px-8 lg:pl-56 lg:py-6">
        {renderTab()}
      </main>

      <nav className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:z-20 md:w-48 lg:w-56 bg-white border-r border-gray-100 md:left-1/2 md:-translate-x-[21rem] lg:left-0 lg:translate-x-0">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2.5">
          <img src="/logo.png" alt="SusuBook" className="w-9 h-9 object-contain rounded-xl shadow-xs" />
          <div className="min-w-0">
            <h1 className="text-base font-black text-gray-900 tracking-tight leading-none">SusuBook</h1>
            <p className="text-[10px] font-medium text-emerald-600 mt-0.5 leading-tight">Your susu properly recorded</p>
          </div>
        </div>
        <div className="flex flex-col py-3 gap-0.5 flex-1">
          {(["today", "collect", "members", "finance", "admin"] as NavTab[]).map((t) => {
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)} className={`flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${active ? "text-emerald-600 bg-emerald-50" : "text-gray-400 hover:bg-gray-50"}`}>
                <NavIcon name={t} active={active} />
                <span className={`text-xs font-semibold ${active ? "text-emerald-600" : "text-gray-400"}`}>{t === "collect" ? "Collect" : tabLabel[t]}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <nav className="md:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100">
        <div className="flex items-end h-16">
          {(["today", "collect", "members", "finance", "admin"] as NavTab[]).map((t) => {
            const active = tab === t;
            const isCta = t === "collect";
            return (
              <button key={t} onClick={() => setTab(t)} className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-colors">
                {isCta ? (
                  <>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${active ? "bg-emerald-600 shadow-emerald-200" : "bg-emerald-500 shadow-emerald-100"}`}>
                      <NavIcon name={t} active={true} />
                    </div>
                    <span className={`text-[10px] font-semibold ${active ? "text-emerald-600" : "text-gray-400"}`}>Collect</span>
                  </>
                ) : (
                  <>
                    <NavIcon name={t} active={active} />
                    <span className={`text-[10px] font-semibold ${active ? "text-emerald-600" : "text-gray-400"}`}>{tabLabel[t]}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      <PWAInstallBanner />
      <UserProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} />
      <MasterAdminPortal isOpen={showMasterAdminModal} onClose={() => setShowMasterAdminModal(false)} />
    </div>
  );
}
