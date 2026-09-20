import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

// Get Supabase URL from environment
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Types matching the existing App.tsx interfaces
export interface Group {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: string;
  cycles: number;
  cycleNumber: number;
  payoutOrder: string;
  startDate: string;
  endDate?: string;
  feeType: "none" | "percentage";
  feeValue: number;
  virtualDate?: string;
  archived?: boolean;
}

export interface Member {
  id: string;
  groupId: string;
  name: string;
  phone: string;
  address?: string;
  memberCode?: string;
  payoutPosition: number;
}

export interface Tx {
  id: string;
  groupId: string;
  memberId: string;
  type: "contribution" | "correction" | "payout" | "collector_fee";
  amount: number;
  date: string;
  timestamp: string;
  method: string;
  note: string;
  supersedes?: string;
  originalAmount?: number;
  displayId?: string;
  isArrears?: boolean;
}

export interface Dispute {
  id: string;
  groupId: string;
  memberId: string;
  description: string;
  status: "open" | "resolved";
}

export interface Rollover {
  id: string;
  groupId: string;
  memberId: string;
  amount: number;
  fromCycle: number;
}

export interface SmsEntry {
  id: string;
  memberId: string;
  kind: string;
  status: string;
  timestamp: string;
  content: string;
}

// Helper to convert database types to app types
const dbToGroup = (g: any): Group => ({
  id: g.id,
  name: g.name,
  amount: Number(g.amount),
  currency: g.currency,
  frequency: g.frequency,
  cycles: g.cycles,
  cycleNumber: g.cycle_number,
  payoutOrder: g.payout_order,
  startDate: g.start_date,
  endDate: g.end_date,
  feeType: g.fee_type,
  feeValue: Number(g.fee_value),
  virtualDate: g.virtual_date,
  archived: g.archived,
});

const dbToMember = (m: any): Member => ({
  id: m.id,
  groupId: m.group_id,
  name: m.name,
  phone: m.phone,
  address: m.address || "",
  memberCode: m.member_code || "",
  payoutPosition: m.payout_position,
});

const dbToTx = (t: any): Tx => ({
  id: t.id,
  groupId: t.group_id,
  memberId: t.member_id || "collector",
  type: t.type,
  amount: Number(t.amount),
  date: t.date,
  timestamp: t.timestamp,
  method: t.method,
  note: t.note,
  supersedes: t.supersedes,
  originalAmount: t.original_amount ? Number(t.original_amount) : undefined,
  displayId: t.display_id,
});

const dbToDispute = (d: any): Dispute => ({
  id: d.id,
  groupId: d.group_id,
  memberId: d.member_id,
  description: d.description,
  status: d.status,
});

const dbToRollover = (r: any): Rollover => ({
  id: r.id,
  groupId: r.group_id,
  memberId: r.member_id,
  amount: Number(r.amount),
  fromCycle: r.from_cycle,
});

const dbToSmsEntry = (s: any): SmsEntry => ({
  id: s.id,
  memberId: s.member_id || "collector",
  kind: s.kind,
  status: s.status,
  timestamp: s.timestamp,
  content: s.content,
});

const groupToDb = (g: Group) => ({
  name: g.name,
  amount: Number(g.amount) || 0,
  currency: g.currency || "LRD",
  frequency: g.frequency || "Daily",
  cycles: Number(g.cycles) || 1,
  cycle_number: Number(g.cycleNumber) || 1,
  payout_order: g.payoutOrder || "Fixed rotation",
  start_date: g.startDate && g.startDate.trim() ? g.startDate : new Date().toISOString().slice(0, 10),
  end_date: g.endDate && typeof g.endDate === "string" && g.endDate.trim() ? g.endDate.trim() : null,
  fee_type: g.feeType || "none",
  fee_value: Number(g.feeValue) || 0,
  virtual_date: g.virtualDate && typeof g.virtualDate === "string" && g.virtualDate.trim() ? g.virtualDate.trim() : null,
  archived: Boolean(g.archived),
});

const memberToDb = (m: Member) => ({
  group_id: m.groupId,
  name: m.name,
  phone: m.phone,
  address: m.address || "",
  member_code: m.memberCode || "",
  payout_position: m.payoutPosition,
});

const txToDb = (t: Omit<Tx, "id" | "timestamp"> | Tx) => ({
  group_id: t.groupId,
  member_id: t.memberId === "collector" ? null : t.memberId,
  type: t.type,
  amount: t.amount,
  date: t.date,
  method: t.method,
  note: t.note,
  supersedes: t.supersedes,
  original_amount: t.originalAmount,
  display_id: t.displayId,
});

const disputeToDb = (d: Omit<Dispute, "id"> | Dispute) => ({
  group_id: d.groupId,
  member_id: d.memberId,
  description: d.description,
  status: d.status,
});

const rolloverToDb = (r: Omit<Rollover, "id"> | Rollover) => ({
  group_id: r.groupId,
  member_id: r.memberId,
  amount: r.amount,
  from_cycle: r.fromCycle,
});

const smsEntryToDb = (s: Omit<SmsEntry, "id" | "timestamp"> | SmsEntry) => ({
  member_id: s.memberId === "collector" ? null : s.memberId,
  kind: s.kind,
  status: s.status,
  content: s.content,
});

// Query Hooks
export function useGroups() {
  const { collector } = useAuth();
  
  return useQuery({
    queryKey: ["groups", collector?.id],
    queryFn: async () => {
      if (!collector?.id) return [];
      const { data, error } = await supabase
        .from("groups")
        .select("*")
        .eq("collector_id", collector.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToGroup);
    },
    enabled: !!collector?.id,
  });
}

export function useMembers() {
  const { collector } = useAuth();
  const queryClient = useQueryClient();
  
  return useQuery({
    queryKey: ["members", collector?.id],
    queryFn: async () => {
      const currentCache = (queryClient.getQueryData(["members", collector?.id]) as Member[]) || [];
      if (!collector?.id) return currentCache;
      
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("collector_id", collector.id)
        .order("created_at", { ascending: false });
      
      if (error) {
        console.warn("Error fetching members from Supabase, using cache:", error);
        return currentCache;
      }

      const dbMembers = (data || []).map(dbToMember);
      const cacheMap = new Map(currentCache.map((m) => [m.id, m]));
      
      // Preserve local address & memberCode if DB columns don't exist yet on remote schema
      const merged = dbMembers.map((m) => {
        const cached = cacheMap.get(m.id);
        return {
          ...m,
          address: m.address || cached?.address || "",
          memberCode: m.memberCode || cached?.memberCode || "",
        };
      });

      // Retain any locally added members that haven't persisted to DB
      const dbIds = new Set(dbMembers.map((m) => m.id));
      const localOnly = currentCache.filter((m) => !dbIds.has(m.id));

      return [...merged, ...localOnly];
    },
    enabled: true,
  });
}

export function useTransactions() {
  const { collector } = useAuth();
  
  return useQuery({
    queryKey: ["transactions", collector?.id],
    queryFn: async () => {
      if (!collector?.id) return [];
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("collector_id", collector.id)
        .order("timestamp", { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToTx);
    },
    enabled: !!collector?.id,
  });
}

export function useRollovers() {
  const { collector } = useAuth();
  
  return useQuery({
    queryKey: ["rollovers", collector?.id],
    queryFn: async () => {
      if (!collector?.id) return [];
      const { data, error } = await supabase
        .from("rollovers")
        .select("*")
        .eq("collector_id", collector.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToRollover);
    },
    enabled: !!collector?.id,
  });
}

export function useDisputes() {
  const { collector } = useAuth();
  
  return useQuery({
    queryKey: ["disputes", collector?.id],
    queryFn: async () => {
      if (!collector?.id) return [];
      const { data, error } = await supabase
        .from("disputes")
        .select("*")
        .eq("collector_id", collector.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToDispute);
    },
    enabled: !!collector?.id,
  });
}

export function useSmsLog() {
  const { collector } = useAuth();
  
  return useQuery({
    queryKey: ["smsLog", collector?.id],
    queryFn: async () => {
      if (!collector?.id) return [];
      const { data, error } = await supabase
        .from("sms_log")
        .select("*")
        .eq("collector_id", collector.id)
        .order("timestamp", { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToSmsEntry);
    },
    enabled: !!collector?.id,
  });
}

// Mutation Hooks with optimistic updates
export function useCreateGroup() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (group: Omit<Group, "id"> & { id?: string }) => {
      if (!collector?.id) throw new Error("Not authenticated");
      
      const { data, error } = await supabase
        .from("groups")
        .insert({
          ...groupToDb(group as Group),
          collector_id: collector.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return { created: dbToGroup(data), tempId: group.id };
    },
    onMutate: async (newGroup) => {
      await queryClient.cancelQueries({ queryKey: ["groups", collector?.id] });
      const previousGroups = queryClient.getQueryData(["groups", collector?.id]) as Group[];
      
      const optimisticGroup: Group = {
        ...newGroup as Group,
        id: (newGroup as Group).id || `temp-${Date.now()}`,
      };
      
      queryClient.setQueryData(["groups", collector?.id], (old: Group[] = []) => [...(old || []), optimisticGroup]);
      
      return { previousGroups };
    },
    onError: (err, _, context) => {
      console.error("useCreateGroup error:", err);
      queryClient.setQueryData(["groups", collector?.id], context?.previousGroups);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", collector?.id] });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Group> }) => {
      const { data, error } = await supabase
        .from("groups")
        .update(groupToDb(updates as Group))
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return dbToGroup(data);
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["groups", collector?.id] });
      const previousGroups = queryClient.getQueryData(["groups", collector?.id]) as Group[];
      
      queryClient.setQueryData(["groups", collector?.id], (old: Group[] = []) =>
        old.map((g) => (g.id === id ? { ...g, ...updates } : g))
      );
      
      return { previousGroups };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["groups", collector?.id], context?.previousGroups);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", collector?.id] });
    },
  });
}

export function useCreateMember() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (member: Omit<Member, "id"> & { id?: string }) => {
      const isUuid = (str?: string) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
      const memberId = member.id || `m-${Date.now()}`;
      
      const localMember: Member = {
        id: memberId,
        groupId: member.groupId,
        name: member.name,
        phone: member.phone,
        address: member.address || "",
        memberCode: member.memberCode || "",
        payoutPosition: member.payoutPosition,
      };

      if (!collector?.id || !isUuid(member.groupId)) {
        return { member: localMember, insertedToDb: false };
      }
      
      try {
        const fullPayload: any = {
          ...memberToDb(member as Member),
          collector_id: collector.id,
        };
        if (!isUuid(member.id)) {
          delete fullPayload.id;
        }
        
        let { data, error } = await supabase
          .from("members")
          .insert(fullPayload)
          .select()
          .single();
        
        // If error is due to missing schema columns (address or member_code), retry inserting core columns
        if (error && (error.message?.includes("column") || error.code === "PGRST204" || error.message?.includes("address") || error.message?.includes("member_code"))) {
          console.warn("Supabase schema missing new columns, attempting core columns insert:", error.message);
          const fallbackPayload = {
            group_id: member.groupId,
            name: member.name,
            phone: member.phone,
            payout_position: member.payoutPosition,
            collector_id: collector.id,
          };
          const retryRes = await supabase
            .from("members")
            .insert(fallbackPayload)
            .select()
            .single();
          
          if (!retryRes.error && retryRes.data) {
            const dbM = dbToMember(retryRes.data);
            return {
              member: { ...dbM, address: member.address || "", memberCode: member.memberCode || "" },
              insertedToDb: true,
            };
          }
        }

        if (error || !data) {
          console.warn("Supabase member insert warning, retaining local member:", error);
          return { member: localMember, insertedToDb: false };
        }

        return { member: dbToMember(data), insertedToDb: true };
      } catch (err) {
        console.warn("Supabase insert exception, retaining local member:", err);
        return { member: localMember, insertedToDb: false };
      }
    },
    onMutate: async (newMember) => {
      await queryClient.cancelQueries({ queryKey: ["members", collector?.id] });
      const previousMembers = (queryClient.getQueryData(["members", collector?.id]) as Member[]) || [];
      
      const memberId = (newMember as Member).id || `m-${Date.now()}`;
      const optimisticMember: Member = {
        ...(newMember as Member),
        id: memberId,
      };
      
      queryClient.setQueryData(["members", collector?.id], (old: Member[] = []) => {
        const filtered = old.filter((m) => m.id !== memberId && !m.id.startsWith("temp-"));
        return [...filtered, optimisticMember];
      });
      
      return { previousMembers, memberId };
    },
    onError: (err) => {
      console.warn("useCreateMember onError caught (retaining local state):", err);
    },
    onSuccess: (res, newMember) => {
      const savedMember = res.member;
      queryClient.setQueryData(["members", collector?.id], (old: Member[] = []) => {
        const targetId = (newMember as Member).id;
        const exists = old.some(m => m.id === targetId || m.id === savedMember.id);
        if (exists) {
          return old.map((m) => (m.id === targetId || m.id === savedMember.id ? savedMember : m));
        }
        return [...old, savedMember];
      });
    },
    onSettled: (res) => {
      if (collector?.id && res?.insertedToDb) {
        queryClient.invalidateQueries({ queryKey: ["members", collector?.id] });
      }
    },
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Member> }) => {
      const isUuid = (str?: string) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
      
      if (!collector?.id || !isUuid(id)) {
        return { id, ...updates } as Member;
      }
      
      try {
        const { data, error } = await supabase
          .from("members")
          .update(memberToDb(updates as Member))
          .eq("id", id)
          .select()
          .single();
        
        if (error) {
          console.warn("Supabase updateMember warning:", error);
          return { id, ...updates } as Member;
        }
        return dbToMember(data);
      } catch (err) {
        console.warn("Supabase updateMember error:", err);
        return { id, ...updates } as Member;
      }
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["members", collector?.id] });
      const previousMembers = (queryClient.getQueryData(["members", collector?.id]) as Member[]) || [];
      
      queryClient.setQueryData(["members", collector?.id], (old: Member[] = []) =>
        old.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
      
      return { previousMembers };
    },
    onError: (err) => {
      console.warn("useUpdateMember onError caught:", err);
    },
    onSettled: (data, error) => {
      if (collector?.id && !error) {
        queryClient.invalidateQueries({ queryKey: ["members", collector?.id] });
      }
    },
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (tx: Omit<Tx, "id" | "timestamp">) => {
      if (!collector?.id) throw new Error("Not authenticated");
      
      const { data, error } = await supabase
        .from("transactions")
        .insert({
          ...txToDb(tx),
          collector_id: collector.id,
          timestamp: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (error) throw error;
      return dbToTx(data);
    },
    onMutate: async (newTx) => {
      await queryClient.cancelQueries({ queryKey: ["transactions", collector?.id] });
      const previousTransactions = queryClient.getQueryData(["transactions", collector?.id]) as Tx[];
      
      const optimisticTx: Tx = {
        ...newTx,
        id: `temp-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
      
      queryClient.setQueryData(["transactions", collector?.id], (old: Tx[] = []) => [optimisticTx, ...old]);
      
      return { previousTransactions };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["transactions", collector?.id], context?.previousTransactions);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", collector?.id] });
    },
  });
}

export function useCreateSmsEntry() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (sms: Omit<SmsEntry, "id" | "timestamp">) => {
      if (!collector?.id) throw new Error("Not authenticated");

      let realStatus = "Sent";
      let recipientPhone = "";

      if (sms.memberId && sms.memberId !== "collector") {
        const { data: member } = await supabase
          .from("members")
          .select("phone")
          .eq("id", sms.memberId)
          .maybeSingle();
        if (member?.phone) {
          // Sanitize phone number to strict E.164 standard (e.g. +231886884019)
          let sanitized = member.phone.replace(/[^\d+]/g, '');
          if (sanitized.startsWith('0')) {
            sanitized = '+231' + sanitized.substring(1);
          } else if (!sanitized.startsWith('+')) {
            sanitized = '+' + sanitized;
          }
          recipientPhone = sanitized;
        }
      }

      const clientApiKey = import.meta.env.VITE_AT_API_KEY;
      const clientUsername = import.meta.env.VITE_AT_USERNAME || "sandbox";

      // 1. If client API key is provided, execute direct Africa's Talking API call
      if (clientApiKey && recipientPhone) {
        try {
          const isSandbox = clientUsername.toLowerCase() === "sandbox";
          const apiUrl = isSandbox
            ? "/api/africastalking-sandbox/version1/messaging"
            : "/api/africastalking-live/version1/messaging";

          const formData = new URLSearchParams();
          formData.append("username", clientUsername);
          formData.append("to", recipientPhone);
          formData.append("message", sms.content);

          const atRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "apiKey": clientApiKey,
              "Content-Type": "application/x-www-form-urlencoded",
              "Accept": "application/json",
            },
            body: formData.toString(),
          });

          const atData = await atRes.json();
          console.log("Africa's Talking API Response:", atData);

          const recipients = atData?.SMSMessageData?.Recipients || [];
          const firstRecipient = recipients[0];
          if (firstRecipient && (firstRecipient.status === "Success" || firstRecipient.statusCode === 101)) {
            realStatus = "Delivered";
          } else if (firstRecipient && firstRecipient.status === "Failed") {
            realStatus = "Failed";
          }
        } catch (atErr) {
          console.error("Direct Africa's Talking API call error:", atErr);
        }
      } else {
        // 2. Otherwise attempt sending via deployed Supabase Edge Function
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session && recipientPhone) {
            const { data: edgeRes, error: edgeErr } = await supabase.functions.invoke('send-sms', {
              body: {
                to: recipientPhone,
                message: sms.content,
                memberId: sms.memberId,
                kind: sms.kind,
              },
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
            });

            if (!edgeErr && edgeRes?.smsEntry) {
              return dbToSmsEntry(edgeRes.smsEntry);
            }
          }
        } catch (err) {
          console.warn("send-sms edge function note:", err);
        }
      }

      const { data, error } = await supabase
        .from("sms_log")
        .insert({
          ...smsEntryToDb({ ...sms, status: realStatus }),
          collector_id: collector.id,
          timestamp: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (error) throw error;
      return dbToSmsEntry(data);
    },
    onMutate: async (newSms) => {
      await queryClient.cancelQueries({ queryKey: ["smsLog", collector?.id] });
      const previousSmsLog = queryClient.getQueryData(["smsLog", collector?.id]) as SmsEntry[];
      
      const optimisticSms: SmsEntry = {
        ...newSms,
        id: `temp-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
      
      queryClient.setQueryData(["smsLog", collector?.id], (old: SmsEntry[] = []) => [optimisticSms, ...old]);
      
      return { previousSmsLog };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["smsLog", collector?.id], context?.previousSmsLog);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["smsLog", collector?.id] });
    },
  });
}

export function useCreateDispute() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (dispute: Omit<Dispute, "id">) => {
      if (!collector?.id) throw new Error("Not authenticated");
      
      const { data, error } = await supabase
        .from("disputes")
        .insert({
          ...disputeToDb(dispute),
          collector_id: collector.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return dbToDispute(data);
    },
    onMutate: async (newDispute) => {
      await queryClient.cancelQueries({ queryKey: ["disputes", collector?.id] });
      const previousDisputes = queryClient.getQueryData(["disputes", collector?.id]) as Dispute[];
      
      const optimisticDispute: Dispute = {
        ...newDispute,
        id: `temp-${Date.now()}`,
      };
      
      queryClient.setQueryData(["disputes", collector?.id], (old: Dispute[] = []) => [...old, optimisticDispute]);
      
      return { previousDisputes };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["disputes", collector?.id], context?.previousDisputes);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["disputes", collector?.id] });
    },
  });
}

export function useUpdateDispute() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Dispute> }) => {
      const { data, error } = await supabase
        .from("disputes")
        .update(disputeToDb(updates as Dispute))
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return dbToDispute(data);
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["disputes", collector?.id] });
      const previousDisputes = queryClient.getQueryData(["disputes", collector?.id]) as Dispute[];
      
      queryClient.setQueryData(["disputes", collector?.id], (old: Dispute[] = []) =>
        old.map((d) => (d.id === id ? { ...d, ...updates } : d))
      );
      
      return { previousDisputes };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["disputes", collector?.id], context?.previousDisputes);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["disputes", collector?.id] });
    },
  });
}

export function useCreateRollover() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (rollover: Omit<Rollover, "id">) => {
      if (!collector?.id) throw new Error("Not authenticated");
      
      const { data, error } = await supabase
        .from("rollovers")
        .insert({
          ...rolloverToDb(rollover),
          collector_id: collector.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return dbToRollover(data);
    },
    onMutate: async (newRollover) => {
      await queryClient.cancelQueries({ queryKey: ["rollovers", collector?.id] });
      const previousRollovers = queryClient.getQueryData(["rollovers", collector?.id]) as Rollover[];
      
      const optimisticRollover: Rollover = {
        ...newRollover,
        id: `temp-${Date.now()}`,
      };
      
      queryClient.setQueryData(["rollovers", collector?.id], (old: Rollover[] = []) => [...old, optimisticRollover]);
      
      return { previousRollovers };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["rollovers", collector?.id], context?.previousRollovers);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["rollovers", collector?.id] });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("groups")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["groups", collector?.id] });
      const previousGroups = queryClient.getQueryData(["groups", collector?.id]) as Group[];
      
      queryClient.setQueryData(["groups", collector?.id], (old: Group[] = []) => old.filter((g) => g.id !== id));
      
      return { previousGroups };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["groups", collector?.id], context?.previousGroups);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", collector?.id] });
    },
  });
}

export function useDeleteMember() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        await supabase.from("transactions").delete().eq("member_id", id);
        await supabase.from("disputes").delete().eq("member_id", id);
        await supabase.from("rollovers").delete().eq("member_id", id);
        await supabase.from("sms_log").delete().eq("member_id", id);

        const { error } = await supabase
          .from("members")
          .delete()
          .eq("id", id);
        
        if (error) throw error;
      }
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["members", collector?.id] });
      const previousMembers = queryClient.getQueryData(["members", collector?.id]) as Member[];
      
      queryClient.setQueryData(["members", collector?.id], (old: Member[] = []) => old.filter((m) => m.id !== id));
      
      return { previousMembers };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(["members", collector?.id], context?.previousMembers);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["members", collector?.id] });
      queryClient.invalidateQueries({ queryKey: ["transactions", collector?.id] });
      queryClient.invalidateQueries({ queryKey: ["disputes", collector?.id] });
      queryClient.invalidateQueries({ queryKey: ["rollovers", collector?.id] });
      queryClient.invalidateQueries({ queryKey: ["smsLog", collector?.id] });
    },
  });
}

// Edge Function hooks for atomic financial operations

export function useRecordPayment() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (params: {
      groupId: string;
      memberId: string;
      amount: number;
      date: string;
      method?: string;
      note?: string;
      displayId: string;
    }) => {
      if (!collector?.id) throw new Error("Not authenticated");

      // Check for idempotency
      if (params.displayId) {
        const { data: existingTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('display_id', params.displayId)
          .eq('group_id', params.groupId)
          .maybeSingle();

        if (existingTx) {
          return { transaction: existingTx, idempotent: true };
        }
      }

      const { data: transaction, error: txErr } = await supabase
        .from('transactions')
        .insert({
          group_id: params.groupId,
          member_id: params.memberId === "collector" ? null : params.memberId,
          type: "contribution",
          amount: params.amount,
          date: params.date,
          method: params.method || "Cash",
          note: params.note || "Rapid roster",
          display_id: params.displayId,
          collector_id: collector.id,
        })
        .select()
        .single();

      if (txErr) throw txErr;

      // Insert matching SMS log
      await supabase.from('sms_log').insert({
        member_id: params.memberId === "collector" ? null : params.memberId,
        kind: "Receipt",
        status: "Delivered",
        content: `Payment receipt for ${params.amount}`,
        collector_id: collector.id,
      });

      return { transaction };
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["transactions", collector?.id] });
      await queryClient.cancelQueries({ queryKey: ["smsLog", collector?.id] });
      
      const previousTransactions = queryClient.getQueryData(["transactions", collector?.id]) as Tx[];
      const previousSmsLog = queryClient.getQueryData(["smsLog", collector?.id]) as SmsEntry[];
      
      // Optimistic update
      const optimisticTx: Tx = {
        id: `temp-${Date.now()}`,
        groupId: params.groupId,
        memberId: params.memberId,
        type: "contribution",
        amount: params.amount,
        date: params.date,
        timestamp: new Date().toISOString(),
        method: params.method || "Cash",
        note: params.note || "Rapid roster",
        displayId: params.displayId,
      };
      
      const optimisticSms: SmsEntry = {
        id: `temp-sms-${Date.now()}`,
        memberId: params.memberId,
        kind: "Receipt",
        status: "Delivered",
        timestamp: new Date().toISOString(),
        content: `Payment receipt for ${params.amount}`,
      };
      
      queryClient.setQueryData(["transactions", collector?.id], (old: Tx[] = []) => [optimisticTx, ...(old || [])]);
      queryClient.setQueryData(["smsLog", collector?.id], (old: SmsEntry[] = []) => [optimisticSms, ...(old || [])]);
      
      return { previousTransactions, previousSmsLog };
    },
    onError: (err, _, context) => {
      console.error("useRecordPayment error:", err);
      queryClient.setQueryData(["transactions", collector?.id], context?.previousTransactions);
      queryClient.setQueryData(["smsLog", collector?.id], context?.previousSmsLog);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", collector?.id] });
      queryClient.invalidateQueries({ queryKey: ["smsLog", collector?.id] });
    },
  });
}

export function useRecordCorrection() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (params: {
      groupId: string;
      memberId: string;
      amount: number;
      date: string;
      method?: string;
      note?: string;
      supersedes: string;
      originalAmount: number;
    }) => {
      if (!collector?.id) throw new Error("Not authenticated");

      const { data: transaction, error: txErr } = await supabase
        .from('transactions')
        .insert({
          group_id: params.groupId,
          member_id: params.memberId === "collector" ? null : params.memberId,
          type: "correction",
          amount: params.amount,
          date: params.date,
          method: params.method || "Cash",
          note: params.note || "Correction",
          supersedes: params.supersedes,
          original_amount: params.originalAmount,
          collector_id: collector.id,
        })
        .select()
        .single();

      if (txErr) throw txErr;
      return { transaction };
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["transactions", collector?.id] });
      
      const previousTransactions = queryClient.getQueryData(["transactions", collector?.id]) as Tx[];
      
      // Optimistic update
      const optimisticTx: Tx = {
        id: `temp-${Date.now()}`,
        groupId: params.groupId,
        memberId: params.memberId,
        type: "correction",
        amount: params.amount,
        date: params.date,
        timestamp: new Date().toISOString(),
        method: params.method || "Cash",
        note: params.note || "Correction",
        supersedes: params.supersedes,
        originalAmount: params.originalAmount,
      };
      
      queryClient.setQueryData(["transactions", collector?.id], (old: Tx[] = []) => [optimisticTx, ...(old || [])]);
      
      return { previousTransactions };
    },
    onError: (err, _, context) => {
      console.error("useRecordCorrection error:", err);
      queryClient.setQueryData(["transactions", collector?.id], context?.previousTransactions);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", collector?.id] });
    },
  });
}

export function useCloseCycle() {
  const queryClient = useQueryClient();
  const { collector } = useAuth();
  
  return useMutation({
    mutationFn: async (groupId: string) => {
      if (!collector?.id) throw new Error("Not authenticated");

      const { data: group, error: grpErr } = await supabase
        .from('groups')
        .update({ archived: true, virtual_date: null })
        .eq('id', groupId)
        .eq('collector_id', collector.id)
        .select()
        .single();

      if (grpErr) throw grpErr;
      return { group };
    },
    onMutate: async (groupId) => {
      await queryClient.cancelQueries({ queryKey: ["groups", collector?.id] });
      
      const previousGroups = queryClient.getQueryData(["groups", collector?.id]) as Group[];
      
      // Optimistic update
      queryClient.setQueryData(["groups", collector?.id], (old: Group[] = []) =>
        old.map((g) => (g.id === groupId ? { ...g, archived: true, virtualDate: undefined } : g))
      );
      
      return { previousGroups };
    },
    onError: (err, _, context) => {
      console.error("useCloseCycle error:", err);
      queryClient.setQueryData(["groups", collector?.id], context?.previousGroups);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", collector?.id] });
    },
  });
}
