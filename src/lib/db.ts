import Dexie, { type Table } from "dexie";
import type { Group, Member, Tx, Dispute, Rollover, SmsEntry } from "../hooks/useSupabaseData";

export interface SyncQueueItem {
  id?: number;
  action: "CREATE" | "UPDATE" | "DELETE" | "RECORD_PAYMENT" | "CLOSE_CYCLE";
  entity: "groups" | "members" | "transactions" | "disputes" | "rollovers" | "smsLog";
  payload: any;
  status: "pending" | "processing" | "failed";
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export class SusuDatabase extends Dexie {
  groups!: Table<Group, string>;
  members!: Table<Member, string>;
  transactions!: Table<Tx, string>;
  disputes!: Table<Dispute, string>;
  rollovers!: Table<Rollover, string>;
  smsLog!: Table<SmsEntry, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super("SusuCollectorDB");

    this.version(1).stores({
      groups: "id, name, frequency, archived, virtualDate",
      members: "id, groupId, name, phone, memberCode",
      transactions: "id, groupId, memberId, date, type, timestamp",
      disputes: "id, groupId, memberId, status",
      rollovers: "id, groupId, memberId, fromCycle",
      smsLog: "id, memberId, kind, status, timestamp",
      syncQueue: "++id, action, entity, status, createdAt",
    });
  }
}

export const db = new SusuDatabase();

// ── Sync Queue Helpers ─────────────────────────────────────────────────────────

export async function enqueueSync(
  action: SyncQueueItem["action"],
  entity: SyncQueueItem["entity"],
  payload: any
): Promise<number> {
  return await db.syncQueue.add({
    action,
    entity,
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

export async function getPendingQueueCount(): Promise<number> {
  return await db.syncQueue.where("status").equals("pending").count();
}

export async function clearSyncQueue(): Promise<void> {
  await db.syncQueue.clear();
}
