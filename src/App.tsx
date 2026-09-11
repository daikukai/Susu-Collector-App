import { useState, useCallback, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
type NavTab = "today" | "collect" | "members" | "finance" | "admin";

interface Group {
  id: string; name: string; amount: number; currency: string;
  frequency: string; cycles: number; cycleNumber: number;
  payoutOrder: string; startDate: string; endDate?: string;
  feeType: "none" | "percentage"; feeValue: number;
  virtualDate?: string; archived?: boolean;
}
interface Member { id: string; groupId: string; name: string; phone: string; payoutPosition: number; }
interface Tx {
  id: string; groupId: string; memberId: string;
  type: "contribution" | "correction" | "payout" | "collector_fee";
  amount: number; date: string; timestamp: string; method: string; note: string;
  supersedes?: string; originalAmount?: number; displayId?: string;
}
interface Dispute { id: string; groupId: string; memberId: string; description: string; status: "open" | "resolved"; }
interface Rollover { id: string; groupId: string; memberId: string; amount: number; fromCycle: number; }
interface SmsEntry { id: string; memberId: string; kind: string; status: string; timestamp: string; content: string; }
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
const nowISO = () => new Date().toISOString();

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

const daysElapsed = (s: string, asOf?: string) => {
  const end = asOf ? new Date(asOf).setHours(0, 0, 0, 0) : new Date().setHours(0, 0, 0, 0);
  return Math.max(Math.floor((end - new Date(s).setHours(0, 0, 0, 0)) / 86400000) + 1, 0);
};
function advanceDate(dateStr: string): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function totalCycleDays(g: Group): number | null {
  if (!g.endDate) return null;
  return daysElapsed(g.startDate, g.endDate);
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

// ── Default state — no demo data ───────────────────────────────────────────────
function defaultState(): AppState {
  return {
    collectorName: "Collector", activeGroupId: "",
    groups: [], members: [], transactions: [], rollovers: [], disputes: [], smsLog: [],
  };
}

const STORE_KEY = "susu_pwa_v4";
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) throw new Error();
    const s = JSON.parse(raw) as AppState;
    if (!s.rollovers) s.rollovers = [];
    s.groups.forEach((g) => {
      if (!g.currency) g.currency = "LRD";
      if (!g.feeType || (g.feeType as string) === "flatDaily" || (g.feeType as string) === "fixedPerCycle") g.feeType = "percentage";
      if (typeof g.feeValue !== "number") g.feeValue = 0;
    });
    // backfill timestamp on old transactions
    s.transactions = s.transactions.map((t) => ({ ...t, timestamp: t.timestamp || t.date + "T00:00:00.000Z" }));
    s.smsLog = s.smsLog.map((x) => ({ ...x, timestamp: (x as { timestamp?: string }).timestamp || (x as { date?: string }).date || nowISO(), content: (x as { content?: string }).content || x.kind }));
    return s;
  } catch { return defaultState(); }
}

// ── Domain helpers ─────────────────────────────────────────────────────────────
function supersededMap(txs: Tx[]): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  txs.forEach((t) => { if (t.supersedes) m[t.supersedes] = true; });
  return m;
}
function memberStats(state: AppState, m: Member) {
  const g = state.groups.find((gr) => gr.id === m.groupId)!;
  const elapsed = daysElapsed(g.startDate, g.virtualDate);
  const carried = state.rollovers.filter((r) => r.memberId === m.id && r.groupId === m.groupId).reduce((a, r) => a + r.amount, 0);
  const expected = g.amount * elapsed + carried;
  const sup = supersededMap(state.transactions);
  const paid = state.transactions.filter((t) => t.memberId === m.id && (t.type === "contribution" || t.type === "correction") && !sup[t.id]).reduce((a, t) => a + t.amount, 0);
  const outstanding = Math.max(0, expected - paid);
  const status = paid >= expected && expected > 0 ? "Paid" : paid > 0 ? "Partial" : elapsed > 0 ? "Unpaid" : "Not due";
  return { expected, paid, outstanding, status, elapsed, carried };
}
function groupTotals(state: AppState, gid: string) {
  const members = state.members.filter((m) => m.groupId === gid);
  const g = state.groups.find((gr) => gr.id === gid)!;
  const sup = supersededMap(state.transactions);
  const contributions = state.transactions
    .filter((t) => t.groupId === gid && (t.type === "contribution" || t.type === "correction") && !sup[t.id])
    .reduce((a, t) => a + t.amount, 0);
  const payouts = state.transactions.filter((t) => t.groupId === gid && (t.type === "payout" || t.type === "collector_fee")).reduce((a, t) => a + t.amount, 0);
  let expected = 0, memberPaid = 0;
  members.forEach((m) => { const s = memberStats(state, m); expected += s.expected; memberPaid += s.paid; });
  const outstanding = Math.max(0, expected - memberPaid);
  const commission = g.feeType === "percentage" ? contributions * ((g.feeValue || 0) / 100) : 0;
  const balance = contributions - payouts - commission;
  // full-cycle expected if endDate known
  const cd = totalCycleDays(g);
  const fullCycleExpected = cd !== null ? members.length * g.amount * cd : expected;
  return { expected, fullCycleExpected, contributions, payouts, outstanding, commission, balance, paid: memberPaid, hasEndDate: !!g.endDate };
}
// Per-member payout = their contributions × (1 - fee%)
function memberPayout(state: AppState, m: Member): number {
  const g = state.groups.find((gr) => gr.id === m.groupId)!;
  const sup = supersededMap(state.transactions);
  const paid = state.transactions.filter((t) => t.memberId === m.id && (t.type === "contribution" || t.type === "correction") && !sup[t.id]).reduce((a, t) => a + t.amount, 0);
  const feeRate = g.feeType === "percentage" ? (g.feeValue || 0) / 100 : 0;
  return Math.max(0, Math.round(paid * (1 - feeRate)));
}
function payoutDate(g: Group): string | null {
  if (!g.endDate) return null;
  return advanceDate(g.endDate);
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
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const t = groupTotals(state, g.id);
  const members = state.members.filter((m) => m.groupId === g.id);
  const rosterDate = g.virtualDate || todayStr();
  const collectedToday = members.filter((m) => state.transactions.some((tx) => tx.memberId === m.id && tx.date === rosterDate && tx.type === "contribution" && tx.groupId === g.id)).length;
  const rosterDone = collectedToday === members.length && members.length > 0;
  const arrearsList = members.filter((m) => memberStats(state, m).outstanding > 0);
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open").length;
  const rate = t.fullCycleExpected > 0 ? Math.min(100, Math.round((t.contributions / t.fullCycleExpected) * 100)) : 0;

  const steps = [
    { n: 1, label: "Collect today's contributions", sub: rosterDone ? `All ${members.length} members collected` : `${collectedToday} of ${members.length} collected`, done: rosterDone, action: () => goCollect("Roster"), actionLabel: rosterDone ? "View roster" : "Open roster" },
    { n: 2, label: "Check for outstanding balances", sub: arrearsList.length > 0 ? `${arrearsList.length} member${arrearsList.length > 1 ? "s" : ""} owe money` : "No arrears right now", done: arrearsList.length === 0, action: () => goFinance("Arrears"), actionLabel: "View arrears" },
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
              <p className="text-xs text-gray-500 mt-0.5">{g.feeValue}% of all contributions collected</p>
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
              <button onClick={step.action} className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-[0.97] ${step.done ? "bg-gray-100 text-gray-400" : "bg-emerald-600 text-white active:bg-emerald-700"}`}>
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
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const members = state.members.filter((m) => m.groupId === g.id);

  const rosterDate = g.virtualDate || todayStr();
  const alreadyPaid = (mid: string) => state.transactions.some((t) => t.type === "contribution" && t.memberId === mid && t.date === rosterDate && t.groupId === g.id);
  const collectedCount = members.filter((m) => alreadyPaid(m.id)).length;

  // Day dashboard stats
  const todayExpected = members.length * g.amount;
  const sup = supersededMap(state.transactions);
  const todayCollected = state.transactions.filter((t) => t.groupId === g.id && t.date === rosterDate && (t.type === "contribution" || t.type === "correction") && !sup[t.id]).reduce((a, t) => a + t.amount, 0);
  const todayOutstanding = Math.max(0, todayExpected - todayCollected);
  const dayRate = todayExpected > 0 ? Math.min(100, Math.round((todayCollected / todayExpected) * 100)) : 0;

  const [rosterToast, setRosterToast] = useState<string | null>(null);

  const tapRoster = (memberId: string) => {
    const recId = mkTxId();
    const ts = nowISO();
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId, type: "contribution", amount: g.amount, date: rosterDate, timestamp: ts, method: "Cash", note: "Rapid roster", displayId: recId };
    const m = members.find((x) => x.id === memberId)!;
    const content = buildSmsContent("Receipt", m, g.amount, g);
    const sms = mkSms(memberId, "Receipt", content);
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setRosterToast(`Receipt sent to ${m.name} · ${m.phone}`);
    setTimeout(() => setRosterToast(null), 3000);
  };

  const closeDay = () => {
    const nextDate = advanceDate(rosterDate);
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
    const amt = parseFloat(payAmt);
    if (!amt || amt <= 0) { setPayErr("Enter an amount greater than 0."); return; }
    setPayErr("");
    const recId = mkTxId();
    const ts = nowISO();
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId: payMember, type: "contribution", amount: amt, date: rosterDate, timestamp: ts, method: payMethod, note: payNote || "Record Payment", displayId: recId };
    const m = members.find((x) => x.id === payMember)!;
    const content = buildSmsContent("Receipt", m, amt, g);
    const sms = mkSms(payMember, "Receipt", content);
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
          {/* Day cycle dashboard */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 text-white">
              <p className="text-xs opacity-70 mb-0.5">{g.name}</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Day collection · {rosterDate}</p>
                <p className="text-xs font-bold opacity-90">{collectedCount}/{members.length} paid</p>
              </div>
              <div className="mt-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs opacity-70">Today's progress</span>
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
              const paid = alreadyPaid(m.id);
              return (
                <div key={m.id} className={`flex items-center justify-between p-3.5 ${i < members.length - 1 ? "border-b border-gray-50" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{m.name}</p>
                    {paid && <p className="text-xs text-emerald-500 mt-0.5">Collected · SMS sent</p>}
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

          {/* Close Day — always enabled, goes to home */}
          <button
            onClick={closeDay}
            className="w-full flex items-center justify-center gap-2 bg-gray-800 text-white font-semibold text-sm py-3 rounded-xl active:bg-gray-900 active:scale-[0.98] transition-all"
          >
            Close Day
          </button>
          {collectedCount < members.length && members.length > 0 && (
            <p className="text-center text-xs text-gray-400">{members.length - collectedCount} member(s) not yet collected — you can still close.</p>
          )}
        </div>
      )}

      {sub === "Record Payment" && (
        <div className="space-y-3 md:max-w-lg md:mx-auto">
          <Card className="p-3 bg-blue-50 border border-blue-100">
            <p className="text-xs text-blue-700 font-medium">Use for non-standard payments — different amounts, mobile money, or partial arrears. SMS receipt is sent automatically.</p>
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
              <Inp value={payNote} onChange={setPayNote} placeholder="e.g. Partial arrears payment" />
            </FieldWrap>
            <PrimaryBtn onClick={recordPayment} className="mt-1">Save &amp; send SMS</PrimaryBtn>
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
                <FieldWrap label="Which payment to correct?">
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
                <FieldWrap label="Member name (correct if misspelled)">
                  <Inp value={corrMemberName} onChange={setCorrMemberName} placeholder={origMember?.name || "Member name"} />
                </FieldWrap>
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
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const add = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Enter the member's full name.";
    if (!phone.trim()) errs.phone = "Enter a phone number for SMS receipts.";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setState({ ...state, members: [...state.members, { id: uid("m"), groupId: g.id, name: name.trim(), phone: phone.trim(), payoutPosition: members.length + 1 }] });
    setName(""); setPhone(""); setErrors({}); setShowAdd(false);
  };
  const openEdit = (m: Member) => { setEditId(m.id); setEditName(m.name); setEditPhone(m.phone); setEditErrors({}); };
  const saveEdit = () => {
    const errs: Record<string, string> = {};
    if (!editName.trim()) errs.name = "Name cannot be empty.";
    if (!editPhone.trim()) errs.phone = "Phone cannot be empty.";
    if (Object.keys(errs).length) { setEditErrors(errs); return; }
    setState({ ...state, members: state.members.map((m) => m.id === editId ? { ...m, name: editName.trim(), phone: editPhone.trim() } : m) });
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
        <Card className="p-4 border border-emerald-100 md:max-w-lg">
          <p className="text-sm font-semibold text-gray-800 mb-3">New member</p>
          <FieldWrap label="Full name" error={errors.name}><Inp value={name} onChange={(v) => { setName(v); setErrors({ ...errors, name: "" }); }} placeholder="e.g. Grace Weah" /></FieldWrap>
          <FieldWrap label="Phone number" error={errors.phone}><Inp value={phone} onChange={(v) => { setPhone(v); setErrors({ ...errors, phone: "" }); }} placeholder="+231 88 000 0000" /></FieldWrap>
          <PrimaryBtn onClick={add}>Add to group</PrimaryBtn>
        </Card>
      )}

      {members.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-gray-400">No members yet.</p>
          <p className="text-xs text-gray-300 mt-1">Add your first member above.</p>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {members.map((m) => (
          <Card key={m.id} className="overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{m.name}</p>
                <p className="text-xs text-gray-500 truncate">{m.phone}</p>
                <p className="text-[10px] font-mono text-gray-400 truncate mt-0.5">{m.id}</p>
              </div>
              <button onClick={() => editId === m.id ? setEditId(null) : openEdit(m)} className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 text-gray-400 transition-all active:scale-95">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>
            {editId === m.id && (
              <div className="mx-3 mb-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                <p className="text-xs font-semibold text-emerald-800 mb-2">Edit member</p>
                <FieldWrap label="Full name" error={editErrors.name}><Inp value={editName} onChange={(v) => { setEditName(v); setEditErrors({ ...editErrors, name: "" }); }} /></FieldWrap>
                <FieldWrap label="Phone number" error={editErrors.phone}><Inp value={editPhone} onChange={(v) => { setEditPhone(v); setEditErrors({ ...editErrors, phone: "" }); }} /></FieldWrap>
                <div className="flex gap-2"><PrimaryBtn onClick={saveEdit} className="flex-1">Save</PrimaryBtn><GhostBtn onClick={() => setEditId(null)} className="flex-1">Cancel</GhostBtn></div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── FINANCE TAB ────────────────────────────────────────────────────────────────
function FinanceTab({ state, setState, initialSub = "Arrears" }: { state: AppState; setState: (s: AppState) => void; initialSub?: string }) {
  const [sub, setSub] = useState(initialSub);
  const g = state.groups.find((gr) => gr.id === state.activeGroupId)!;
  const members = state.members.filter((m) => m.groupId === g.id);
  const t = groupTotals(state, g.id);

  // ── Arrears ──
  const arrearsList = members.map((m) => ({ m, s: memberStats(state, m) })).filter((x) => x.s.outstanding > 0).sort((a, b) => b.s.outstanding - a.s.outstanding);
  const [remindConfirm, setRemindConfirm] = useState("");
  const [arrearsToast, setArrearsToast] = useState("");

  const sendReminders = () => {
    const newSms = arrearsList.map((x) => {
      const content = buildSmsContent("Payment reminder", x.m, x.s.outstanding, g);
      return mkSms(x.m.id, "Payment reminder", content);
    });
    setState({ ...state, smsLog: [...newSms, ...state.smsLog] });
    setRemindConfirm(`Reminder SMS sent to ${arrearsList.length} member(s).`);
  };

  const payArrearsFull = (memberId: string, amount: number) => {
    const m = members.find((x) => x.id === memberId)!;
    const ts = nowISO();
    const recId = mkTxId();
    const newTx: Tx = { id: uid("t"), groupId: g.id, memberId, type: "contribution", amount, date: ts.slice(0, 10), timestamp: ts, method: "Cash", note: "Arrears payment (full)", displayId: recId };
    const content = buildSmsContent("Arrears receipt", m, amount, g);
    const sms = mkSms(memberId, "Arrears receipt", content);
    setState({ ...state, transactions: [...state.transactions, newTx], smsLog: [sms, ...state.smsLog] });
    setArrearsToast(`${fmt(amount, g.currency)} arrears recorded for ${m.name} · SMS sent`);
    setTimeout(() => setArrearsToast(""), 3500);
  };

  // ── Payouts ──
  const pd = payoutDate(g);
  const sup = supersededMap(state.transactions);
  const hasPayout = (memberId: string) => state.transactions.some((t) => t.type === "payout" && t.memberId === memberId && t.groupId === g.id);
  const hasCollectorPayout = state.transactions.some((t) => t.type === "collector_fee" && t.groupId === g.id);
  const openDisputeMembers = new Set(state.disputes.filter((d) => d.groupId === g.id && d.status === "open").map((d) => d.memberId));
  const [poMethod, setPoMethod] = useState("Cash");
  const [poConfirm, setPoConfirm] = useState("");

  const recordPayout = (memberId: string, amount: number) => {
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
    if (tx.type === "contribution" || tx.type === "correction") running += tx.amount;
    else if (tx.type === "payout" || tx.type === "collector_fee") running -= tx.amount;
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
          <Card className={`p-4 flex items-center justify-between ${t.outstanding > 0 ? "bg-red-50 border border-red-100" : "bg-emerald-50 border border-emerald-100"}`}>
            <div>
              <p className={`text-xs font-medium ${t.outstanding > 0 ? "text-red-500" : "text-emerald-600"}`}>Total outstanding</p>
              <p className={`text-xl font-bold ${t.outstanding > 0 ? "text-red-700" : "text-emerald-700"}`}>{fmt(t.outstanding, g.currency)}</p>
            </div>
            {t.outstanding === 0 && <Badge color="green"><CheckIcon className="w-3 h-3" /> All paid up</Badge>}
          </Card>
          {arrearsToast && <Toast msg={arrearsToast} />}
          {arrearsList.length > 0 && (
            <>
              <Card className="p-3 bg-blue-50 border border-blue-100">
                <p className="text-xs text-blue-700 font-medium">Full outstanding balance is paid here. For partial payments, use Collect → Record Payment.</p>
              </Card>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {arrearsList.map((x) => (
                  <Card key={x.m.id} className="p-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{x.m.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fmt(x.s.outstanding, g.currency)} outstanding</p>
                      </div>
                      <button
                        onClick={() => payArrearsFull(x.m.id, x.s.outstanding)}
                        className="text-xs font-semibold text-white bg-emerald-600 px-3 py-1.5 rounded-lg active:bg-emerald-700 transition-all"
                      >
                        Pay in full · {fmt(x.s.outstanding, g.currency)}
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
              <GhostBtn onClick={sendReminders}>Send reminder SMS to {arrearsList.length} member{arrearsList.length > 1 ? "s" : ""}</GhostBtn>
              {remindConfirm && <Toast msg={remindConfirm} />}
            </>
          )}
          {arrearsList.length === 0 && <Card className="p-6 text-center"><p className="text-sm text-gray-400">No outstanding balances right now.</p></Card>}
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
                        : <button onClick={() => recordPayout(m.id, amount)} className="text-xs font-semibold text-white bg-emerald-600 px-3 py-1.5 rounded-lg active:bg-emerald-700 transition-all">Record payout</button>
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
              <p className="text-xs text-gray-400 mb-3">{g.feeValue}% of all contributions · {fmt(t.commission, g.currency)} earned</p>
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
              const isDebit = tx.type === "payout" || tx.type === "collector_fee";
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
  const corrections = state.transactions.filter((x) => x.groupId === g.id && x.type === "correction");
  const openDisputes = state.disputes.filter((d) => d.groupId === g.id && d.status === "open");
  const rows = [
    { label: "Total contributions (credits)", val: fmt(t.contributions, g.currency) },
    { label: "Payouts made (debits)", val: fmt(t.payouts, g.currency) },
    ...(t.commission > 0 ? [{ label: "Collector's fee", val: fmt(t.commission, g.currency) }] : []),
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
        <FieldWrap label="Member"><Sel value={dpMember} onChange={setDpMember}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Sel></FieldWrap>
        <FieldWrap label="Description" error={dpErr}><Inp value={dpDesc} onChange={(v) => { setDpDesc(v); setDpErr(""); }} placeholder="What is being disputed?" /></FieldWrap>
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
  const [gName, setGName] = useState("");
  const [gAmt, setGAmt] = useState("");
  const [gCur, setGCur] = useState("LRD");
  const [gFreq, setGFreq] = useState("Daily");
  const [gStart, setGStart] = useState(todayStr());
  const [gEnd, setGEnd] = useState("");
  const [feePercent, setFeePercent] = useState(0);
  const [gErrors, setGErrors] = useState<Record<string, string>>({});

  const createGroup = () => {
    const errs: Record<string, string> = {};
    if (!gName.trim()) errs.name = "Enter a group name.";
    const amt = parseFloat(gAmt);
    if (!amt || amt <= 0) errs.amount = "Enter a contribution amount.";
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

  return (
    <div className="space-y-3">
      <BackBtn onClick={onBack} /><p className="text-base font-semibold text-gray-800">Groups</p>

      {activeGroups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeGroups.map((gr) => (
            <Card key={gr.id} className="p-3.5">
              <div className="flex items-center justify-between">
              <div><p className="text-sm font-semibold text-gray-800">{gr.name}</p><p className="text-xs text-gray-400">{state.members.filter((m) => m.groupId === gr.id).length} members · {gr.frequency} · cycle {gr.cycleNumber}{gr.endDate ? ` · ends ${gr.endDate}` : ""}</p></div>
              {gr.id === state.activeGroupId ? <Badge color="green">Active</Badge> : <button onClick={() => setState({ ...state, activeGroupId: gr.id })} className="text-xs font-semibold text-emerald-600">Switch</button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {archivedGroups.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Archived</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {archivedGroups.map((gr) => (
              <Card key={gr.id} className="p-3.5">
                <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium text-gray-500">{gr.name}</p><p className="text-xs text-gray-300">{state.members.filter((m) => m.groupId === gr.id).length} members · closed</p></div>
                <Badge color="gray">Archived</Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm font-semibold text-gray-700 pt-1">Create a new group</p>
      <Card className="p-4 space-y-0 md:max-w-lg">
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
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-400">Your collector's fee</p>
            <span className="text-xs font-bold text-emerald-700">{feePercent === 0 ? "No fee" : `${feePercent}% per contribution`}</span>
          </div>
          <input type="range" min={0} max={50} step={1} value={feePercent} onChange={(e) => setFeePercent(Number(e.target.value))} className="w-full accent-emerald-600 h-2 rounded-full" />
          <div className="flex justify-between text-[10px] text-gray-300 mt-1"><span>0%</span><span>25%</span><span>50%</span></div>
          {feePercent > 0 && gAmt && (
            <p className="text-xs text-emerald-600 mt-1.5 bg-emerald-50 rounded-lg px-2.5 py-1.5">
              You keep {gCur} {Math.round(parseFloat(gAmt) * feePercent / 100).toLocaleString()} from each {gCur} {gAmt} payment
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
  const goHome = () => setTab("today");

  const activeGroups = state.groups.filter((g) => !g.archived);
  const hasActiveGroup = activeGroups.length > 0 && !!state.activeGroupId && !state.groups.find((g) => g.id === state.activeGroupId)?.archived;

  // Auto-select first active group if activeGroupId is stale/empty
  useEffect(() => {
    if (!hasActiveGroup && activeGroups.length > 0) {
      setState({ ...state, activeGroupId: activeGroups[0].id });
    }
  }, [hasActiveGroup, activeGroups.length]);

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
        <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-black">S</span>
        </div>
        <p className="text-sm font-semibold text-gray-800 flex-1">{tabLabel[tab]}</p>
        <p className="text-xs text-gray-400">{state.collectorName}</p>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24 md:pl-48 md:pb-4 lg:px-8 lg:pl-56 lg:py-6">
        {renderTab()}
      </main>

      <nav className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:z-20 md:w-48 lg:w-56 bg-white border-r border-gray-100 md:left-1/2 md:-translate-x-[21rem] lg:left-0 lg:translate-x-0">
        <div className="flex flex-col py-4 gap-0.5">
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
    </div>
  );
}
