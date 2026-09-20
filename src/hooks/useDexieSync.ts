import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, enqueueSync, type SyncQueueItem } from "../lib/db";
import { supabase } from "../lib/supabase";
import type { Group, Member, Tx, Dispute, Rollover, SmsEntry } from "./useSupabaseData";

export function useDexieSync() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Monitor network online/offline events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Live count of pending queue items in Dexie IndexedDB
  const pendingCount = useLiveQuery(
    async () => await db.syncQueue.where("status").equals("pending").count(),
    [],
    0
  );

  // Background queue sync function
  const processQueue = useCallback(async () => {
    if (!navigator.onLine || isSyncing) return;
    
    const pendingItems = await db.syncQueue.where("status").equals("pending").toArray();
    if (pendingItems.length === 0) return;

    setIsSyncing(true);

    for (const item of pendingItems) {
      if (!item.id) continue;

      try {
        await db.syncQueue.update(item.id, { status: "processing" });

        let success = false;

        if (item.entity === "members" && item.action === "CREATE") {
          const m: Member = item.payload;
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.groupId);
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user && isUuid) {
            const { error } = await supabase.from("members").insert({
              group_id: m.groupId,
              name: m.name,
              phone: m.phone,
              address: m.address || "",
              member_code: m.memberCode || "",
              payout_position: m.payoutPosition,
              collector_id: session.user.id,
            });
            if (!error) success = true;
          } else {
            // Local offline mode succeeds by default
            success = true;
          }
        } else if (item.entity === "transactions" && item.action === "CREATE") {
          const t: Tx = item.payload;
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const { error } = await supabase.from("transactions").insert({
              group_id: t.groupId,
              member_id: t.memberId === "collector" ? null : t.memberId,
              type: t.type,
              amount: t.amount,
              date: t.date,
              method: t.method,
              note: t.note,
              display_id: t.displayId,
              collector_id: session.user.id,
              timestamp: t.timestamp || new Date().toISOString(),
            });
            if (!error) success = true;
          } else {
            success = true;
          }
        } else if (item.entity === "groups" && item.action === "CREATE") {
          const g: Group = item.payload;
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const { error } = await supabase.from("groups").insert({
              name: g.name,
              amount: g.amount,
              currency: g.currency,
              frequency: g.frequency,
              cycles: g.cycles,
              cycle_number: g.cycleNumber,
              payout_order: g.payoutOrder,
              start_date: g.startDate,
              end_date: g.endDate,
              fee_type: g.feeType,
              fee_value: g.feeValue,
              virtual_date: g.virtualDate,
              archived: g.archived,
              collector_id: session.user.id,
            });
            if (!error) success = true;
          } else {
            success = true;
          }
        } else {
          success = true;
        }

        if (success) {
          await db.syncQueue.delete(item.id);
        } else {
          await db.syncQueue.update(item.id, {
            status: "pending",
            retryCount: item.retryCount + 1,
            lastError: "Sync attempt failed, will retry",
          });
        }
      } catch (err: any) {
        console.warn("Sync queue item error:", err);
        await db.syncQueue.update(item.id, {
          status: "pending",
          retryCount: item.retryCount + 1,
          lastError: err?.message || "Unknown error",
        });
      }
    }

    setLastSyncTime(new Date().toLocaleTimeString());
    setIsSyncing(false);
  }, [isSyncing]);

  // Trigger sync on online state change
  useEffect(() => {
    if (isOnline) {
      processQueue();
    }
  }, [isOnline, processQueue]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    lastSyncTime,
    processQueue,
  };
}
