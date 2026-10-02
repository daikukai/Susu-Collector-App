import { supabase } from "./supabase";

export async function requireSessionUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user?.id) {
    throw new Error("You are not signed in. Sign in again to save data.");
  }
  return data.session.user.id;
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export function persistErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Could not save to the server. Try again.";
}
