import { useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
type NavTab = "today" | "collect" | "members" | "finance" | "admin";

interface Group {
  id: string; name: string; amount: number; currency: string;
  frequency: string; cycles: number; cycleNumber: number;
  payoutOrder: string; startDate: string; endDate?: string;
  feeType: "none" | "flatDaily" | "percentage" | "fixedPerCycle";
  feeValue: number;
}
interface Member { id: string; groupId: string; name: string; phone: string; payoutPosition: number; }
interface Tx {
  id: string; groupId: string; memberId: string;
  type: "contribution" | "correction" | "payout";
  amount: number; date: string; method: string; note: string;
  supersedes?: string; originalAmount?: number; displayId?: string;
}
interface Dispute { id: string; groupId: string; memberId: string; description: string; status: "open" | "resolved"; }
interface Rollover { id: string; groupId: string; memberId: string; amount: number; fromCycle: number; }
interface SmsEntry { id: string; memberId: string; kind: string; status: string; date: string; }
interface AppState {
  collectorName: string; activeGroupId: string;
  groups: Group[]; members: Member[]; transactions: Tx[];
  rollovers: Rollover[]; disputes: Dispute[]; smsLog: SmsEntry[];
}

// ── Utils ──────────────────────────────────────────────────────────────────────
let _uidSeq = 0;
const uid = (p: string) => p + "-" + Date.now().toString(36) + (++_uidSeq).toString(36);
const mkTxId = () => {
  const d = new Date();
  return "SUSU-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + String(Math.floor(Math.random() * 900000) + 100000);
};
const fmt = (n: number, currency = "LRD") => currency + " " + Math.round(n).toLocaleString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysElapsed = (s: string) => Math.max(Math.floor((new Date().setHours(0,0,0,0) - new Date(s).setHours(0,0,0,0)) / 86400000) + 1, 0);

function defaultState(): AppState {
  const today = new Date();
  const start = new Date(today); start.setDate(start.getDate() - 18);
  const gid = "g-broad-street";
  const members: Member[] = [
    { id: "m1", groupId: gid, name: "Sarah Doe", phone: "+231 88 123 4567", payoutPosition: 1 },
    { id: "m2", groupId: gid, name: "Esther Doe", phone: "+231 77 765 4321", payoutPosition: 2 },
    { id: "m3", groupId: gid, name: "James Kollie", phone: "+231 88 987 6543", payoutPosition: 3 },
    { id: "m4", groupId: gid, name: "Martha Johnson", phone: "+231 77 222 1111", payoutPosition: 4 },
    { id: "m5", groupId: gid, name: "Peter Wilson", phone: "+231 88 333 2222", payoutPosition: 5 },
    { id: "m6", groupId: gid, name: "David Brown", phone: "+231 88 555 6666", payoutPosition: 6 },
  ];
  const tx: Tx[] = [];
  const day = new Date(start);
  for (let i = 0; i < 18; i++) {
    members.forEach((m) => {
      const amt = Math.random() > 0.15 ? 500 : Math.random() > 0.5 ? 300 : 0;
      if (amt > 0) tx.push({ id: uid("t"), groupId: gid, memberId: m.id, type: "contribution", amount: amt, date: new Date(day).toISOString().slice(0, 10), method: Math.random() > 0.6 ? "MTN" : "Cash", note: "" });
    });
    day.setDate(day.getDate() + 1);
  }
  tx.push({ id: uid("t"), groupId: gid, memberId: "m1", type: "payout", amount: 15000, date: start.toISOString().slice(0, 10), method: "Cash", note: "" });
  return {
    collectorName: "Mary Johnson", activeGroupId: gid,
    groups: [{ id: gid, name: "Broad Street Market Susu", amount: 500, currency: "LRD", frequency: "Daily", cycles: 1, cycleNumber: 3, payoutOrder: "Fixed rotation", startDate: start.toISOString().slice(0, 10), feeType: "flatDaily", feeValue: 0 }],
    members, transactions: tx, rollovers: [],
    disputes: [
      { id: uid("d"), groupId: gid, memberId: "m3", description: "Says he paid Sept 3, no record found", status: "open" },
      { id: uid("d"), groupId: gid, memberId: "m4", description: "Disputes the amount recorded on Sept 2", status: "open" },
    ],
    smsLog: [],
  };
}

const STORE_KEY = "susu_pwa_v3";
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) throw new Error();
    const s = JSON.parse(raw) as AppState;
    if (!s.rollovers) s.rollovers = [];
    s.groups.forEach((g) => { if (!g.currency) g.currency = "LRD"; if (!g.feeType) g.feeType = "none"; if (typeof g.feeValue !== "number") g.feeValue = 0; });
    return s;
  } catch { return defaultState(); }
}

// ── Domain helpers ─────────────────────────────────────────────────────────────
function memberStats(state: AppState, m: Member) {
  const g = state.groups.find((gr) => gr.id === m.groupId)!;
  const elapsed = daysElapsed(g.startDate);
  const carried = state.rollovers.filter((r) => r.memberId === m.id && r.groupId === m.groupId).reduce((a, r) => a + r.amount, 0);
  const expected = g.amount * elapsed + carried;
  const superseded: Record<string, boolean> = {};
  state.transactions.forEach((t) => { if (t.supersedes) superseded[t.supersedes] = true; });
  const paid = state.transactions.filter((t) => t.memberId === m.id && (t.type === "contribution" || t.type === "correction") && !superseded[t.id]).reduce((a, t) => a + t.amount, 0);
  const outstanding = Math.max(0, expected - paid);
  const status = paid >= expected && expected > 0 ? "Paid" : paid > 0 ? "Partial" : elapsed > 0 ? "Unpaid" : "Not due";
  return { expected, paid, outstanding, status, elapsed, carried };
}
function groupTotals(state: AppState, gid: string) {
  const members = state.members.filter((m) => m.groupId === gid);
  const g = state.groups.find((gr) => gr.id === gid)!;
  // contributions = money coming IN (credits)
  const superseded: Record<string, boolean> = {};
  state.transactions.forEach((t) => { if (t.supersedes) superseded[t.supersedes] = true; });
  const contributions = state.transactions
    .filter((t) => t.groupId === gid && (t.type === "contribution" || t.type === "correction") && !superseded[t.id])
    .reduce((a, t) => a + t.amount, 0);
  // payouts = money going OUT (debits)
  const payouts = state.transactions
    .filter((t) => t.groupId === gid && t.type === "payout")
    .reduce((a, t) => a + t.amount, 0);
  // expected = what all members should have paid by now
  let expected = 0, memberPaid = 0;
  members.forEach((m) => { const s = memberStats(state, m); expected += s.expected; memberPaid += s.paid; });
  const outstanding = Math.max(0, expected - memberPaid);
  // collector's fee
  let commission = 0;
  if (g.feeType === "flatDaily") commission = g.amount * members.length;
  else if (g.feeType === "percentage") commission = contributions * ((g.feeValue || 0) / 100);
  else if (g.feeType === "fixedPerCycle") commission = g.feeValue || 0;
  // balance = money currently in the pot
  const balance = contributions - payouts - commission;
  return { expected, contributions, payouts, outstanding, commission, balance, paid: memberPaid };
}
function payoutRotation(state: AppState, gid: string) {
  const members = state.members.filter((m) => m.groupId === gid).sort((a, b) => a.payoutPosition - b.payoutPosition);
  const g = state.groups.find((gr) => gr.id === gid)!;
  const start = new Date(g.startDate);
  let dueAssigned = false;
  return members.map((m, i) => {
    const paid = state.transactions.find((t) => t.type === "payout" && t.memberId === m.id);
    const due = new Date(start); due.setDate(due.getDate() + (i + 1) * 7);
    const status: "Paid" | "Due" | "Upcoming" = paid ? "Paid" : !dueAssigned ? "Due" : "Upcoming";
    if (!paid && !dueAssigned) dueAssigned = true;
    return { member: m, due: due.toISOString().slice(0, 10), amount: g.amount * members.length, status };
  });
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
function FieldWrap({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-medium text-gray-400 mb-1">{label}</p>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
function Inp({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-gray-50 border border-gray-100 text-gray-800 text-sm rounded-xl px-3 py-2.5 placeholder-gray-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-50" />;
}
function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-gray-50 border border-gray-100 text-gray-800 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-50">{children}</select>;
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
  if (name === "today") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/></svg>;
  if (name === "collect") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
  if (name === "members") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (name === "finance") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
  if (name === "admin") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>;
  return null;
}

// ── TODAY TAB ──────────────────────────────────────────────────────────────────
function TodayTab({ state, setState, goCollect, goFinance }: {
  state: AppState; setState: (s: AppState) => void;
  goCollect: (sub: string) => void; goFinance: (sub: string) => void;
}) {
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const t = groupTotals(state, g.id);
  const members = state.members.filter((m) => m.groupId === g.id);
  const today = todayStr();
  const collectedToday = members.filter((m) => state.transactions.some((tx) => tx.memberId === m.id && tx.date === today && tx.type === "contribution" && tx.groupId === g.id)).length;
  const rosterDone = collectedToday === members.length && members.length > 0;
  const arrearsList = members.filter((m) => memberStats(state, m).outstanding > 0);
  const rot = payoutRotation(state, g.id);
  const payoutDue = rot.find((r) => r.status === "Due");
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length;
  const rate = t.expected > 0 ? Math.round((t.contributions / t.expected) * 100) : 0;

  const steps = [
    { n: 1, label: "Collect today's contributions", sub: rosterDone ? `All ${members.length} members collected` : `${collectedToday} of ${members.length} collected`, done: rosterDone, action: () => goCollect("Roster"), actionLabel: rosterDone ? "View roster" : "Open roster" },
    { n: 2, label: "Check for outstanding balances", sub: arrearsList.length > 0 ? `${arrearsList.length} member${arrearsList.length > 1 ? "s" : ""} owe money` : "No arrears right now", done: arrearsList.length === 0, action: () => goFinance("Arrears"), actionLabel: "View arrears" },
    { n: 3, label: "Record any pending payouts", sub: payoutDue ? `${payoutDue.member.name} is due ${fmt(payoutDue.amount, g.currency)}` : "No payouts due right now", done: !payoutDue, action: () => goFinance("Payouts"), actionLabel: "Record payout" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary hero */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 text-white">
          <p className="text-xs font-medium opacity-70 mb-0.5">{g.name} · Cycle {g.cycleNumber}</p>
          <p className="text-3xl font-bold tracking-tight">{fmt(t.balance, g.currency)}</p>
          <p className="text-xs opacity-70 mt-0.5">current pot balance</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-white/20 rounded-full h-1.5">
              <div className="bg-white h-1.5 rounded-full" style={{ width: `${Math.min(rate, 100)}%` }} />
            </div>
            <span className="text-xs font-semibold opacity-90">{rate}% collected</span>
          </div>
          {/* Credit / debit summary */}
          <div className="mt-3 flex gap-4">
            <div>
              <p className="text-xs opacity-60">+ Total in</p>
              <p className="text-sm font-semibold">{fmt(t.contributions, g.currency)}</p>
            </div>
            <div>
              <p className="text-xs opacity-60">− Payouts</p>
              <p className="text-sm font-semibold">{fmt(t.payouts, g.currency)}</p>
            </div>
            {t.commission > 0 && (
              <div>
                <p className="text-xs opacity-60">− Your fee</p>
                <p className="text-sm font-semibold">{fmt(t.commission, g.currency)}</p>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          {[
            { label: "Expected", val: fmt(t.expected, g.currency) },
            { label: "Outstanding", val: fmt(t.outstanding, g.currency), warn: t.outstanding > 0 },
            { label: "Members", val: `${members.length}` },
          ].map((s) => (
            <div key={s.label} className="p-3 text-center">
              <p className="text-xs text-gray-400 mb-0.5">{s.label}</p>
              <p className={`text-sm font-semibold ${(s as {warn?: boolean}).warn ? "text-amber-600" : "text-gray-800"}`}>{s.val}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Your earnings */}
      {g.feeType !== "none" && (
        <Card className="p-4 flex items-center justify-between border border-emerald-100">
          <div>
            <p className="text-xs text-gray-400">Your collector's earnings</p>
            <p className="text-xs text-gray-500 mt-0.5">Deducted from pot balance</p>
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
            <p className="text-xs text-amber-600">Resolve before closing the cycle</p>
          </div>
        </div>
      )}

      {/* Daily workflow steps */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Today's workflow</p>
        <div className="space-y-2">
          {steps.map((step) => (
            <Card key={step.n} className={`border ${step.done ? "border-emerald-100" : "border-gray-100"}`}>
              <div className="flex items-center gap-3 p-4">
                <StepBadge n={step.n} done={step.done} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${step.done ? "text-gray-400 line-through" : "text-gray-800"}`}>{step.label}</p>
                  <p className={`text-xs mt-0.5 ${step.done ? "text-gray-300" : "text-gray-400"}`}>{step.sub}</p>
                </div>
                <button onClick={step.action} className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-[0.97] ${step.done ? "bg-gray-100 text-gray-400" : "bg-emerald-600 text-white active:bg-emerald-700"}`}>
                  {step.actionLabel}
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Group switcher */}
      {state.groups.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Switch group</p>
          <div className="flex gap-2 flex-wrap">
            {state.groups.map((gr) => (
              <button key={gr.id} onClick={() => setState({ ...state, activeGroupId: gr.id })}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${gr.id === state.activeGroupId ? "bg-emerald-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
                {gr.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── COLLECT TAB ────────────────────────────────────────────────────────────────
function CollectTab({ state, setState, initialSub = "Roster" }: { state: AppState; setState: (s: AppState) => void; initialSub?: string }) {
  const [sub, setSub] = useState(initialSub);
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const members = state.members.filter((m) => m.groupId === g.id);

  // Roster state
  const today = todayStr();
  const alreadyPaid = (mid: string) => state.transactions.some((t) => t.type === "contribution" && t.memberId === mid && t.date === today && t.groupId === g.id);
  const collectedCount = members.filter((m) => alreadyPaid(m.id)).length;
  const tapRoster = (memberId: string) => {
    const recId = mkTxId();
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId, type: "contribution", amount: g.amount, date: today, method: "Cash", note: "Rapid roster", displayId: recId };
    const sms: SmsEntry = { id: uid("sms"), memberId, kind: "Receipt", status: "Delivered", date: new Date().toISOString() };
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
  };

  // Record payment state
  const [payMember, setPayMember] = useState(members[0]?.id || "");
  const [payAmt, setPayAmt] = useState(String(g.amount));
  const [payMethod, setPayMethod] = useState("Cash");
  const [payNote, setPayNote] = useState("");
  const [payErr, setPayErr] = useState("");
  const [payConfirm, setPayConfirm] = useState("");

  // Correction state
  const superseded: Record<string, boolean> = {};
  state.transactions.forEach((t) => { if (t.supersedes) superseded[t.supersedes] = true; });
  const candidates = state.transactions.filter((t) => t.groupId === g.id && t.type === "contribution" && !superseded[t.id]);
  const [corrTx, setCorrTx] = useState(candidates[0]?.id || "");
  const [corrAmt, setCorrAmt] = useState(() => candidates[0] ? String(candidates[0].amount) : "");
  const [corrReason, setCorrReason] = useState("");
  const [corrErrors, setCorrErrors] = useState<Record<string, string>>({});
  const [corrConfirm, setCorrConfirm] = useState("");
  const origTx = candidates.find((t) => t.id === corrTx);
  const origMember = origTx ? state.members.find((m) => m.id === origTx.memberId) : null;

  const recordPayment = () => {
    const amt = parseFloat(payAmt);
    if (!amt || amt <= 0) { setPayErr("Enter an amount greater than 0."); return; }
    setPayErr("");
    const recId = mkTxId();
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId: payMember, type: "contribution", amount: amt, date: today, method: payMethod, note: payNote, displayId: recId };
    const sms: SmsEntry = { id: uid("sms"), memberId: payMember, kind: "Receipt", status: "Delivered", date: new Date().toISOString() };
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    const m = members.find((x) => x.id === payMember);
    setPayConfirm(`Saved · ${recId} · Receipt sent to ${m?.phone}`);
    setPayAmt(String(g.amount)); setPayNote("");
  };

  const saveCorrection = () => {
    const errs: Record<string, string> = {};
    const amt = parseFloat(corrAmt);
    if (!amt || amt < 0) errs.amount = "Enter a valid amount.";
    if (!corrReason.trim()) errs.reason = "Explain why this is being corrected.";
    if (Object.keys(errs).length) { setCorrErrors(errs); return; }
    if (!origTx) return;
    const newTx: Tx = { id: uid("t"), groupId: origTx.groupId, memberId: origTx.memberId, type: "correction", amount: amt, date: today, method: origTx.method, note: corrReason, supersedes: origTx.id, originalAmount: origTx.amount };
    setState({ ...state, transactions: [...state.transactions, newTx] });
    setCorrConfirm(`Correction saved. Original ${fmt(origTx.amount, g.currency)} entry retained for audit.`);
    setCorrErrors({}); setCorrReason("");
  };

  return (
    <div>
      <InlineTab tabs={["Roster", "Record Payment", "Correct Entry"]} active={sub} onChange={setSub} />

      {sub === "Roster" && (
        <div className="space-y-3">
          <Card className="p-4 bg-emerald-50 border border-emerald-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-emerald-800">Daily collection · {today}</p>
              <p className="text-xs font-bold text-emerald-700">{collectedCount}/{members.length}</p>
            </div>
            <div className="w-full bg-emerald-200 rounded-full h-1.5">
              <div className="bg-emerald-600 h-1.5 rounded-full transition-all" style={{ width: `${members.length > 0 ? (collectedCount / members.length) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-emerald-600 mt-1.5">Tap each member as they pay {fmt(g.amount, g.currency)} cash. For other amounts, use Record Payment.</p>
          </Card>
          <Card>
            {members.map((m, i) => {
              const paid = alreadyPaid(m.id);
              return (
                <div key={m.id} className={`flex items-center justify-between p-3.5 ${i < members.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{m.name}</p>
                    {paid && <p className="text-xs text-emerald-500 mt-0.5">Collected today</p>}
                  </div>
                  {paid
                    ? <Badge color="green"><CheckIcon className="w-3 h-3" /> Done</Badge>
                    : <button onClick={() => tapRoster(m.id)} className="bg-emerald-600 text-white text-xs font-bold px-4 py-1.5 rounded-lg active:bg-emerald-700 active:scale-[0.97] transition-all shadow-sm shadow-emerald-200">Tap to collect</button>
                  }
                </div>
              );
            })}
            {members.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No members yet — add them in the Members tab.</p>}
          </Card>
        </div>
      )}

      {sub === "Record Payment" && (
        <div className="space-y-3">
          <Card className="p-3 bg-blue-50 border border-blue-100">
            <p className="text-xs text-blue-700 font-medium">Use this for non-standard payments — different amounts, mobile money, or back-dated entries. For same-day cash at the standard amount, use the Roster instead.</p>
          </Card>
          <Card className="p-4 space-y-0">
            <FieldWrap label="Member">
              <Sel value={payMember} onChange={setPayMember}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Sel>
            </FieldWrap>
            <FieldWrap label={`Amount (${g.currency})`} error={payErr}>
              <Inp value={payAmt} onChange={(v) => { setPayAmt(v); setPayErr(""); }} placeholder={String(g.amount)} />
            </FieldWrap>
            <FieldWrap label="Payment method">
              <div className="flex gap-2">
                {["Cash", "MTN", "Orange"].map((m) => (
                  <button key={m} onClick={() => setPayMethod(m)} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${payMethod === m ? "bg-emerald-600 text-white shadow-sm" : "bg-gray-100 text-gray-500"}`}>{m}</button>
                ))}
              </div>
            </FieldWrap>
            <FieldWrap label="Note (optional)">
              <Inp value={payNote} onChange={setPayNote} placeholder="e.g. Paid at shop, late fee included" />
            </FieldWrap>
            <PrimaryBtn onClick={recordPayment} className="mt-1">Save payment</PrimaryBtn>
            {payConfirm && <Toast msg={payConfirm} />}
          </Card>
        </div>
      )}

      {sub === "Correct Entry" && (
        <div className="space-y-3">
          <Card className="p-3 bg-amber-50 border border-amber-100">
            <p className="text-xs text-amber-700 font-medium">Use this to fix a recorded payment. The original entry is never deleted — it stays in the audit trail so your records are always complete.</p>
          </Card>
          {candidates.length === 0
            ? <Card className="p-6 text-center"><p className="text-sm text-gray-400">No contribution entries to correct yet.</p></Card>
            : (
              <Card className="p-4 space-y-0">
                <FieldWrap label="Which payment to correct?">
                  <Sel value={corrTx} onChange={(id) => { setCorrTx(id); const t = candidates.find((x) => x.id === id); if (t) setCorrAmt(String(t.amount)); }}>
                    {candidates.map((t) => { const m = state.members.find((x) => x.id === t.memberId); return <option key={t.id} value={t.id}>{m?.name} · {fmt(t.amount, g.currency)} · {t.date}</option>; })}
                  </Sel>
                </FieldWrap>
                {origTx && origMember && (
                  <div className="bg-gray-50 rounded-xl p-3 mb-3">
                    <p className="text-xs text-gray-400 mb-1">Original entry</p>
                    <p className="text-sm font-medium text-gray-700">{origMember.name} · {fmt(origTx.amount, g.currency)} · {origTx.date}</p>
                  </div>
                )}
                <FieldWrap label={`Corrected amount (${g.currency})`} error={corrErrors.amount}>
                  <Inp value={corrAmt} onChange={(v) => { setCorrAmt(v); setCorrErrors({ ...corrErrors, amount: "" }); }} />
                </FieldWrap>
                <FieldWrap label="Reason for correction" error={corrErrors.reason}>
                  <Inp value={corrReason} onChange={(v) => { setCorrReason(v); setCorrErrors({ ...corrErrors, reason: "" }); }} placeholder="e.g. Miscounted cash at collection" />
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
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const members = state.members.filter((m) => m.groupId === g.id);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);

  const statusColor = (s: string) => s === "Paid" ? "green" : s === "Partial" ? "amber" : s === "Unpaid" ? "red" : "gray";

  const add = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Enter the member's full name.";
    if (!phone.trim()) errs.phone = "Enter a phone number for SMS receipts.";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setState({ ...state, members: [...state.members, { id: uid("m"), groupId: g.id, name: name.trim(), phone: phone.trim(), payoutPosition: members.length + 1 }] });
    setName(""); setPhone(""); setErrors({}); setShowAdd(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{members.length} members · {g.name}</p>
        <button onClick={() => setShowAdd(!showAdd)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${showAdd ? "bg-gray-100 text-gray-500" : "bg-emerald-600 text-white"}`}>
          {showAdd ? "Cancel" : "+ Add member"}
        </button>
      </div>

      {showAdd && (
        <Card className="p-4 border border-emerald-100">
          <p className="text-sm font-semibold text-gray-800 mb-3">New member</p>
          <FieldWrap label="Full name" error={errors.name}><Inp value={name} onChange={(v) => { setName(v); setErrors({ ...errors, name: "" }); }} placeholder="e.g. Grace Weah" /></FieldWrap>
          <FieldWrap label="Phone number" error={errors.phone}><Inp value={phone} onChange={(v) => { setPhone(v); setErrors({ ...errors, phone: "" }); }} placeholder="+231 88 000 0000" /></FieldWrap>
          <PrimaryBtn onClick={add}>Add to group</PrimaryBtn>
        </Card>
      )}

      <Card>
        {members.map((m, i) => {
          const s = memberStats(state, m);
          return (
            <div key={m.id} className={`p-3.5 ${i < members.length - 1 ? "border-b border-gray-50" : ""}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{m.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{m.phone}</p>
                </div>
                <Badge color={statusColor(s.status)}>{s.status}</Badge>
              </div>
              {s.outstanding > 0 && (
                <div className="mt-2 bg-red-50 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                  <p className="text-xs text-red-500">Owes</p>
                  <p className="text-xs font-bold text-red-600">{fmt(s.outstanding, g.currency)}</p>
                </div>
              )}
            </div>
          );
        })}
        {members.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-sm text-gray-400">No members yet.</p>
            <p className="text-xs text-gray-300 mt-1">Add your first member to get started.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── FINANCE TAB ────────────────────────────────────────────────────────────────
function FinanceTab({ state, setState, initialSub = "Arrears" }: { state: AppState; setState: (s: AppState) => void; initialSub?: string }) {
  const [sub, setSub] = useState(initialSub);
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const members = state.members.filter((m) => m.groupId === g.id);
  const t = groupTotals(state, g.id);
  const rot = payoutRotation(state, g.id);

  // Arrears
  const arrearsList = members.map((m) => ({ m, s: memberStats(state, m) })).filter((x) => x.s.outstanding > 0).sort((a, b) => b.s.outstanding - a.s.outstanding);
  const [remindConfirm, setRemindConfirm] = useState("");
  const sendReminders = () => {
    const newSms = arrearsList.map((x) => ({ id: uid("sms"), memberId: x.m.id, kind: "Payment reminder", status: "Sent", date: new Date().toISOString() }));
    setState({ ...state, smsLog: [...newSms, ...state.smsLog] });
    setRemindConfirm(`Reminder sent to ${arrearsList.length} member(s).`);
  };

  // Payouts
  const due = rot.find((r) => r.status === "Due");
  const [poAmt, setPoAmt] = useState(due ? String(due.amount) : "");
  const [poMethod, setPoMethod] = useState("Cash");
  const [poConfirm, setPoConfirm] = useState("");
  const [poErr, setPoErr] = useState("");
  const recordPayout = (memberId: string) => {
    const amt = parseFloat(poAmt);
    if (!amt || amt <= 0) { setPoErr("Enter a valid amount."); return; }
    const sms: SmsEntry = { id: uid("sms"), memberId, kind: "Payout confirmation", status: "Delivered", date: new Date().toISOString() };
    setState({ ...state, transactions: [...state.transactions, { id: uid("t"), groupId: g.id, memberId, type: "payout", amount: amt, date: todayStr(), method: poMethod, note: "" }], smsLog: [sms, ...state.smsLog] });
    const m = members.find((x) => x.id === memberId);
    setPoConfirm(`Payout recorded for ${m?.name}.`);
  };

  // Ledger — compute running balance (oldest first, then reverse for display)
  const [ledType, setLedType] = useState("all");
  const [ledMethod, setLedMethod] = useState("all");
  const supersededIds: Record<string, boolean> = {};
  state.transactions.forEach((tx) => { if (tx.supersedes) supersededIds[tx.supersedes] = true; });
  const allGroupTx = state.transactions.filter((tx) => tx.groupId === g.id && !supersededIds[tx.id]).sort((a, b) => a.date.localeCompare(b.date));
  // build running balance oldest→newest
  let running = 0;
  const withBalance = allGroupTx.map((tx) => {
    if (tx.type === "contribution" || tx.type === "correction") running += tx.amount;
    else if (tx.type === "payout") running -= tx.amount;
    return { tx, runningBalance: running };
  });
  // now filter + reverse for display (newest first)
  const ledRows = withBalance
    .filter(({ tx }) => (ledType === "all" || tx.type === ledType) && (ledMethod === "all" || tx.method === ledMethod))
    .reverse();

  const tabLabels = ["Arrears", "Payouts", "Ledger"];

  return (
    <div>
      <InlineTab tabs={tabLabels} active={sub} onChange={setSub} />

      {sub === "Arrears" && (
        <div className="space-y-3">
          <Card className={`p-4 flex items-center justify-between ${t.outstanding > 0 ? "bg-red-50 border border-red-100" : "bg-emerald-50 border border-emerald-100"}`}>
            <div>
              <p className={`text-xs font-medium ${t.outstanding > 0 ? "text-red-500" : "text-emerald-600"}`}>Total outstanding</p>
              <p className={`text-xl font-bold ${t.outstanding > 0 ? "text-red-700" : "text-emerald-700"}`}>{fmt(t.outstanding, g.currency)}</p>
            </div>
            {t.outstanding === 0 && <Badge color="green"><CheckIcon className="w-3 h-3" /> All paid up</Badge>}
          </Card>
          {arrearsList.length > 0 && (
            <>
              <Card>
                {arrearsList.map((x, i) => (
                  <div key={x.m.id} className={`flex items-center justify-between p-3.5 ${i < arrearsList.length - 1 ? "border-b border-gray-50" : ""}`}>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{x.m.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{x.s.status}</p>
                    </div>
                    <p className="text-sm font-bold text-red-600">{fmt(x.s.outstanding, g.currency)}</p>
                  </div>
                ))}
              </Card>
              <GhostBtn onClick={sendReminders}>Send reminder SMS to {arrearsList.length} member{arrearsList.length > 1 ? "s" : ""}</GhostBtn>
              {remindConfirm && <Toast msg={remindConfirm} />}
            </>
          )}
          {arrearsList.length === 0 && <Card className="p-6 text-center"><p className="text-sm text-gray-400">No outstanding balances right now.</p></Card>}
        </div>
      )}

      {sub === "Payouts" && (
        <div className="space-y-3">
          <Card>
            {rot.map((r, i) => (
              <div key={r.member.id} className={`flex items-center justify-between p-3.5 ${i < rot.length - 1 ? "border-b border-gray-50" : ""}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-800">{r.member.name}</p>
                    {r.status === "Due" && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">Due {r.due} · {fmt(r.amount, g.currency)}</p>
                </div>
                <Badge color={r.status === "Paid" ? "green" : r.status === "Due" ? "blue" : "gray"}>{r.status}</Badge>
              </div>
            ))}
          </Card>
          {due && (
            <Card className="p-4 border border-blue-100">
              <p className="text-sm font-semibold text-gray-800 mb-1">Record payout for {due.member.name}</p>
              <p className="text-xs text-gray-400 mb-3">Amount due: {fmt(due.amount, g.currency)}</p>
              <FieldWrap label={`Amount (${g.currency})`} error={poErr}>
                <Inp value={poAmt} onChange={(v) => { setPoAmt(v); setPoErr(""); }} />
              </FieldWrap>
              <FieldWrap label="Payment method">
                <div className="flex gap-2">
                  {["Cash", "MTN", "Orange"].map((m) => (
                    <button key={m} onClick={() => setPoMethod(m)} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${poMethod === m ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}>{m}</button>
                  ))}
                </div>
              </FieldWrap>
              <PrimaryBtn onClick={() => recordPayout(due.member.id)}>Record payout</PrimaryBtn>
              {poConfirm && <Toast msg={poConfirm} />}
            </Card>
          )}
        </div>
      )}

      {sub === "Ledger" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Sel value={ledType} onChange={setLedType}>
              <option value="all">All types</option>
              <option value="contribution">Contributions</option>
              <option value="correction">Corrections</option>
              <option value="payout">Payouts</option>
            </Sel>
            <Sel value={ledMethod} onChange={setLedMethod}>
              <option value="all">All methods</option>
              <option value="Cash">Cash</option>
              <option value="MTN">MTN</option>
              <option value="Orange">Orange</option>
            </Sel>
          </div>
          {/* Balance summary strip */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Total in", val: fmt(t.contributions, g.currency), color: "text-emerald-700 bg-emerald-50" },
              { label: "Paid out", val: fmt(t.payouts, g.currency), color: "text-red-600 bg-red-50" },
              { label: "Pot balance", val: fmt(t.balance, g.currency), color: "text-blue-700 bg-blue-50 font-bold" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-2.5 text-center ${s.color}`}>
                <p className="text-xs opacity-70 mb-0.5">{s.label}</p>
                <p className={`text-xs font-semibold leading-tight ${s.color.includes("bold") ? "font-bold text-sm" : ""}`}>{s.val}</p>
              </div>
            ))}
          </div>
          <Card>
            {/* Header row */}
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-gray-100 bg-gray-50 rounded-t-2xl">
              <p className="text-xs font-semibold text-gray-400 flex-1">Member / type</p>
              <p className="text-xs font-semibold text-gray-400 w-24 text-right">Amount</p>
              <p className="text-xs font-semibold text-gray-400 w-28 text-right">Pot balance</p>
            </div>
            {ledRows.map(({ tx, runningBalance }, i) => {
              const m = state.members.find((x) => x.id === tx.memberId);
              const isDebit = tx.type === "payout";
              const isCorrection = tx.type === "correction";
              return (
                <div key={tx.id} className={`flex items-center justify-between px-3.5 py-3 ${i < ledRows.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{m?.name || "?"}{isCorrection ? " (correction)" : isDebit ? " (payout)" : ""}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{tx.date} · {tx.method}</p>
                  </div>
                  <p className={`text-sm font-semibold w-24 text-right ${isDebit ? "text-red-600" : "text-emerald-600"}`}>
                    {isDebit ? "−" : "+"}{fmt(tx.amount, g.currency)}
                  </p>
                  <p className="text-sm font-semibold text-gray-700 w-28 text-right">{fmt(runningBalance, g.currency)}</p>
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

// ── ADMIN SUB-SCREENS (extracted to avoid conditional hook calls) ──────────────
function BackBtn({ onClick, label = "Admin" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-sm text-gray-500 font-medium mb-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>{label}
    </button>
  );
}

function ReconcileSub({ state, g, t, onBack }: { state: AppState; g: Group; t: ReturnType<typeof groupTotals>; onBack: () => void }) {
  const corrections = state.transactions.filter((x) => x.groupId === g.id && x.type === "correction");
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open");
  const rows = [
    { label: "Total contributions (credits)", val: fmt(t.contributions, g.currency) },
    { label: "Payouts made (debits)", val: fmt(t.payouts, g.currency) },
    ...(t.commission > 0 ? [{ label: "Collector's fee (debit)", val: fmt(t.commission, g.currency) }] : []),
    { label: "Pot balance", val: fmt(t.balance, g.currency), bold: true },
    { label: "Expected contributions", val: fmt(t.expected, g.currency) },
    { label: "Outstanding from members", val: fmt(t.outstanding, g.currency) },
  ];
  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">Reconciliation</p>
      <Card>
        {rows.map((r, i) => (
          <div key={r.label} className={`flex justify-between p-3.5 ${i < rows.length - 1 ? "border-b border-gray-50" : ""}`}>
            <p className={`text-sm ${(r as { bold?: boolean }).bold ? "font-semibold text-gray-800" : "text-gray-500"}`}>{r.label}</p>
            <p className={`text-sm ${(r as { bold?: boolean }).bold ? "font-semibold text-gray-800" : "text-gray-700"}`}>{r.val}</p>
          </div>
        ))}
      </Card>
      {(corrections.length > 0 || openDisputes.length > 0)
        ? <div className="bg-amber-50 border border-amber-200 rounded-xl p-3"><p className="text-sm font-semibold text-amber-700 mb-1">⚠ Review before closing</p>{corrections.length > 0 && <p className="text-xs text-amber-600">{corrections.length} correction(s) this cycle.</p>}{openDisputes.length > 0 && <p className="text-xs text-amber-600">{openDisputes.length} unresolved dispute(s).</p>}</div>
        : <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3"><p className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckIcon className="w-4 h-4" />No flagged inconsistencies.</p></div>
      }
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
        {disputes.map((d, i) => {
          const m = state.members.find((x) => x.id === d.memberId);
          return (
            <div key={d.id} className={`p-3.5 ${i < disputes.length - 1 ? "border-b border-gray-50" : ""}`}>
              <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold text-gray-800">{m?.name}</p><Badge color={d.status === "open" ? "amber" : "green"}>{d.status}</Badge></div>
              <p className="text-xs text-gray-500 mb-2">{d.description}</p>
              {d.status === "open" && <button onClick={() => resolve(d.id)} className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg active:bg-emerald-100">Mark resolved</button>}
            </div>
          );
        })}
        {disputes.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No disputes yet.</p>}
      </Card>
      <Card className="p-4">
        <p className="text-sm font-semibold text-gray-800 mb-3">Log a dispute</p>
        <FieldWrap label="Member"><Sel value={dpMember} onChange={setDpMember}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Sel></FieldWrap>
        <FieldWrap label="Description" error={dpErr}><Inp value={dpDesc} onChange={(v) => { setDpDesc(v); setDpErr(""); }} placeholder="What is being disputed?" /></FieldWrap>
        <PrimaryBtn onClick={addDispute}>Log dispute</PrimaryBtn>
      </Card>
    </div>
  );
}

function CycleSub({ state, setState, g, t, rot, onBack }: { state: AppState; setState: (s: AppState) => void; g: Group; t: ReturnType<typeof groupTotals>; rot: ReturnType<typeof payoutRotation>; onBack: () => void }) {
  const allPayoutsDone = rot.every((r) => r.status === "Paid");
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length;
  const [rollAck, setRollAck] = useState(false);
  const [cycleConfirm, setCycleConfirm] = useState("");
  const hardBlockers = !allPayoutsDone || openDisputes > 0;
  const needsAck = t.outstanding > 0;
  const blocked = hardBlockers || (needsAck && !rollAck);
  const closeCycle = () => {
    const members = state.members.filter((m) => m.groupId === g.id);
    const newRollovers = state.rollovers.filter((r) => r.groupId !== g.id);
    members.forEach((m) => { const s = memberStats(state, m); if (s.outstanding > 0) newRollovers.push({ id: uid("ro"), groupId: g.id, memberId: m.id, amount: s.outstanding, fromCycle: g.cycleNumber }); });
    setState({ ...state, groups: state.groups.map((gr) => gr.id === g.id ? { ...gr, cycleNumber: gr.cycleNumber + 1, startDate: todayStr() } : gr), rollovers: newRollovers });
    setCycleConfirm(`Cycle closed. Now on cycle ${g.cycleNumber + 1}. Outstanding balances carried forward.`);
  };
  const items = [
    { label: "All contributions collected", pass: t.outstanding === 0, soft: true, detail: t.outstanding === 0 ? "No outstanding balances." : `${fmt(t.outstanding, g.currency)} outstanding` },
    { label: "All payouts recorded", pass: allPayoutsDone, detail: allPayoutsDone ? "Every member has been paid out." : `${rot.filter((r) => r.status !== "Paid").length} payout(s) pending` },
    { label: "No open disputes", pass: openDisputes === 0, detail: openDisputes === 0 ? "All disputes resolved." : `${openDisputes} dispute(s) still open` },
  ];
  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">Close Cycle {g.cycleNumber}</p>
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
      {needsAck && (
        <label className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 cursor-pointer">
          <input type="checkbox" checked={rollAck} onChange={(e) => setRollAck(e.target.checked)} className="mt-0.5 accent-emerald-600" />
          <span className="text-xs text-amber-700">Roll over {fmt(t.outstanding, g.currency)} in outstanding balances to the next cycle. Members keep the debt, carried forward.</span>
        </label>
      )}
      <PrimaryBtn onClick={closeCycle} disabled={blocked}>{blocked ? "Resolve items above first" : "Close cycle"}</PrimaryBtn>
      {cycleConfirm && <Toast msg={cycleConfirm} />}
    </div>
  );
}

function GroupsSub({ state, setState, onBack }: { state: AppState; setState: (s: AppState) => void; onBack: () => void }) {
  const [gName, setGName] = useState(""); const [gAmt, setGAmt] = useState(""); const [gCur, setGCur] = useState("LRD"); const [gFreq, setGFreq] = useState("Daily"); const [gStart, setGStart] = useState(todayStr()); const [gEnd, setGEnd] = useState(""); const [gFeeType, setGFeeType] = useState<Group["feeType"]>("none"); const [gFeeVal, setGFeeVal] = useState(""); const [gErrors, setGErrors] = useState<Record<string, string>>({});
  const createGroup = () => {
    const errs: Record<string, string> = {};
    if (!gName.trim()) errs.name = "Enter a group name.";
    const amt = parseFloat(gAmt);
    if (!amt || amt <= 0) errs.amount = "Enter a contribution amount.";
    if (Object.keys(errs).length) { setGErrors(errs); return; }
    const ng: Group = { id: uid("g"), name: gName.trim(), amount: amt, currency: gCur, frequency: gFreq, cycles: 1, cycleNumber: 1, payoutOrder: "Fixed rotation", startDate: gStart || todayStr(), endDate: gEnd || undefined, feeType: gFeeType, feeValue: parseFloat(gFeeVal) || 0 };
    setState({ ...state, groups: [...state.groups, ng], activeGroupId: ng.id });
    setGName(""); setGAmt(""); setGErrors({});
  };
  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">Groups</p>
      <Card>
        {state.groups.map((gr, i) => (
          <div key={gr.id} className={`flex items-center justify-between p-3.5 ${i < state.groups.length - 1 ? "border-b border-gray-50" : ""}`}>
            <div><p className="text-sm font-semibold text-gray-800">{gr.name}</p><p className="text-xs text-gray-400">{state.members.filter((m) => m.groupId === gr.id).length} members · {gr.frequency} · cycle {gr.cycleNumber}{gr.endDate ? ` · ends ${gr.endDate}` : ""}</p></div>
            {gr.id === state.activeGroupId ? <Badge color="green">Active</Badge> : <button onClick={() => setState({ ...state, activeGroupId: gr.id })} className="text-xs font-semibold text-emerald-600">Switch</button>}
          </div>
        ))}
      </Card>
      <p className="text-sm font-semibold text-gray-700 pt-1">Create a new group</p>
      <Card className="p-4 space-y-0">
        <FieldWrap label="Group name" error={gErrors.name}><Inp value={gName} onChange={(v) => { setGName(v); setGErrors({ ...gErrors, name: "" }); }} placeholder="e.g. Church Savings Group" /></FieldWrap>
        <div className="flex gap-2">
          <div className="flex-1"><FieldWrap label={`Amount (${gCur})`} error={gErrors.amount}><Inp value={gAmt} onChange={(v) => { setGAmt(v); setGErrors({ ...gErrors, amount: "" }); }} placeholder="500" /></FieldWrap></div>
          <div className="w-24"><FieldWrap label="Currency"><Sel value={gCur} onChange={setGCur}><option>LRD</option><option>USD</option></Sel></FieldWrap></div>
        </div>
        <FieldWrap label="Frequency"><Sel value={gFreq} onChange={setGFreq}><option>Daily</option><option>Weekly</option><option>Monthly</option></Sel></FieldWrap>
        <div className="flex gap-2">
          <div className="flex-1"><FieldWrap label="Start date"><Inp type="date" value={gStart} onChange={setGStart} /></FieldWrap></div>
          <div className="flex-1"><FieldWrap label="End date"><Inp type="date" value={gEnd} onChange={setGEnd} /></FieldWrap></div>
        </div>
        <FieldWrap label="Your fee (collector's hand)"><Sel value={gFeeType} onChange={(v) => setGFeeType(v as Group["feeType"])}><option value="none">Not tracked</option><option value="flatDaily">Keep one full round</option><option value="percentage">Percentage of collections</option><option value="fixedPerCycle">Fixed amount per cycle</option></Sel></FieldWrap>
        {(gFeeType === "percentage" || gFeeType === "fixedPerCycle") && <FieldWrap label={gFeeType === "percentage" ? "Percentage (%)" : "Fixed amount"}><Inp value={gFeeVal} onChange={setGFeeVal} placeholder="e.g. 5" /></FieldWrap>}
        <PrimaryBtn onClick={createGroup} className="mt-1">Create group</PrimaryBtn>
      </Card>
    </div>
  );
}

function SmsSub({ state, setState, onBack }: { state: AppState; setState: (s: AppState) => void; onBack: () => void }) {
  const list = state.smsLog.slice(0, 30);
  const retry = (id: string) => setState({ ...state, smsLog: state.smsLog.map((s) => s.id === id ? { ...s, status: "Delivered" } : s) });
  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">SMS Log</p>
      <Card>
        {list.map((s, i) => {
          const m = state.members.find((x) => x.id === s.memberId);
          return (
            <div key={s.id} className={`flex items-center justify-between p-3.5 ${i < list.length - 1 ? "border-b border-gray-50" : ""}`}>
              <div><p className="text-sm font-medium text-gray-800">{m?.name || "?"}</p><p className="text-xs text-gray-400">{s.kind}</p></div>
              <div className="flex items-center gap-2">
                <Badge color={s.status === "Delivered" ? "green" : s.status === "Sent" ? "blue" : "red"}>{s.status}</Badge>
                {s.status === "Failed" && <button onClick={() => retry(s.id)} className="text-xs font-semibold text-emerald-600">Retry</button>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No SMS activity yet.</p>}
      </Card>
    </div>
  );
}

// ── ADMIN TAB ──────────────────────────────────────────────────────────────────
function AdminTab({ state, setState, onReset }: { state: AppState; setState: (s: AppState) => void; onReset: () => void }) {
  const [sub, setSub] = useState<string | null>(null);
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const t = groupTotals(state, g.id);
  const rot = payoutRotation(state, g.id);

  if (sub === "Reconcile") return <ReconcileSub state={state} g={g} t={t} onBack={() => setSub(null)} />;
  if (sub === "Disputes") return <DisputesSub state={state} setState={setState} g={g} onBack={() => setSub(null)} />;
  if (sub === "Cycle") return <CycleSub state={state} setState={setState} g={g} t={t} rot={rot} onBack={() => setSub(null)} />;
  if (sub === "Groups") return <GroupsSub state={state} setState={setState} onBack={() => setSub(null)} />;
  if (sub === "SMS") return <SmsSub state={state} setState={setState} onBack={() => setSub(null)} />;


  // Admin menu
  const adminItems = [
    { key: "Reconcile", label: "Reconciliation", sub: "Verify your books balance", icon: "⚖️" },
    { key: "Disputes", label: "Disputes", sub: "Log and resolve member disputes", icon: "💬", badge: state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length },
    { key: "Cycle", label: "Close Cycle", sub: "End cycle and roll over balances", icon: "🔄" },
    { key: "Groups", label: "Groups", sub: "Manage or create savings groups", icon: "👥" },
    { key: "SMS", label: "SMS Log", sub: "Message delivery history", icon: "📱" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Occasional tasks — run at the end of each cycle or as needed.</p>
      <Card>
        {adminItems.map((item, i) => (
          <button key={item.key} onClick={() => setSub(item.key)} className={`w-full flex items-center gap-3 p-4 text-left active:bg-gray-50 transition-colors ${i < adminItems.length - 1 ? "border-b border-gray-50" : ""}`}>
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
        ))}
      </Card>
      <button onClick={onReset} className="w-full text-xs text-gray-300 py-2 active:text-red-400 transition-colors">Reset demo data</button>
    </div>
  );
}

// ── ROOT APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setStateRaw] = useState<AppState>(loadState);
  const [tab, setTab] = useState<NavTab>("today");
  const [collectSub, setCollectSub] = useState("Roster");
  const [financeSub, setFinanceSub] = useState("Arrears");

  const setState = useCallback((s: AppState) => {
    setStateRaw(s);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, []);

  const goCollect = (sub: string) => { setCollectSub(sub); setTab("collect"); };
  const goFinance = (sub: string) => { setFinanceSub(sub); setTab("finance"); };

  const reset = () => {
    if (!confirm("Reset all data back to the demo starting point?")) return;
    setState(defaultState()); setTab("today");
  };

  const tabLabel: Record<NavTab, string> = { today: "Today", collect: "Collect", members: "Members", finance: "Finance", admin: "Admin" };

  const renderTab = () => {
    switch (tab) {
      case "today": return <TodayTab state={state} setState={setState} goCollect={goCollect} goFinance={goFinance} />;
      case "collect": return <CollectTab key={collectSub} state={state} setState={setState} initialSub={collectSub} />;
      case "members": return <MembersTab state={state} setState={setState} />;
      case "finance": return <FinanceTab key={financeSub} state={state} setState={setState} initialSub={financeSub} />;
      case "admin": return <AdminTab state={state} setState={setState} onReset={reset} />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 max-w-md mx-auto">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 h-14 flex items-center gap-3 flex-shrink-0">
        <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-black">S</span>
        </div>
        <p className="text-sm font-semibold text-gray-800 flex-1">{tabLabel[tab]}</p>
        <p className="text-xs text-gray-400">{state.collectorName}</p>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {renderTab()}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100">
        <div className="flex items-end h-16">
          {(["today", "collect", "members", "finance", "admin"] as NavTab[]).map((t) => {
            const active = tab === t;
            const isCta = t === "collect";
            return (
              <button key={t} onClick={() => setTab(t)} className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-colors">
                {isCta ? (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${active ? "bg-emerald-600 shadow-emerald-200" : "bg-emerald-500 shadow-emerald-100"}`}>
                    <NavIcon name={t} active={true} />
                  </div>
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
    </div>
  );
}
