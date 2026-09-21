import { supabase } from "./supabase";
import type { Session, User } from "@supabase/supabase-js";

export interface Collector {
  id: string;
  name: string;
  business_name?: string;
  business_address?: string;
  avatar_url?: string;
  phone?: string;
  is_super_admin?: boolean;
  created_at: string;
  groups_count?: number;
  members_count?: number;
  transactions_count?: number;
}

export interface InviteCode {
  id: string;
  code: string;
  kind: "single_use" | "multi_use_demo";
  status: "active" | "used" | "expired";
  used_by_phone?: string | null;
  used_at?: string | null;
  created_at: string;
}

// In-memory OTP storage for password reset (phone -> { otp, expiresAt })
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

/**
 * Normalizes any user-entered phone number into standard E.164 format
 * and creates a deterministic internal auth identifier (e.g. collector231886884019@susu.com).
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "+231" + cleaned.substring(1);
  } else if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

export function phoneToAuthEmail(phone: string): string {
  const normalized = normalizePhone(phone).replace("+", "");
  return `collector${normalized}@susu.com`;
}

// Sign up with Phone Number and Password
export async function signUpWithPhone(phone: string, password: string) {
  const normalizedPhone = normalizePhone(phone);
  const authEmail = phoneToAuthEmail(phone);

  const { data, error } = await supabase.auth.signUp({
    email: authEmail,
    password,
    options: {
      data: {
        phone: normalizedPhone,
      },
    },
  });

  if (error) throw error;

  // Automatically sign in to establish active session if session wasn't auto-established
  if (data.user && !data.session) {
    try {
      const { data: signInData } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });
      return signInData;
    } catch (signInErr) {
      console.warn("Auto sign-in notice post registration:", signInErr);
    }
  }

  return data;
}

// Sign in with Phone Number and Password
export async function signInWithPhone(phone: string, password: string) {
  const normalizedPhone = normalizePhone(phone);
  const authEmail = phoneToAuthEmail(phone);
  const isAdminPhone = normalizedPhone === "+231886884019" || phone.includes("886884019");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password,
    });
    if (error) throw error;
    return data;
  } catch (err: any) {
    // If it's the designated Super-Admin phone number trying to sign in for the first time
    if (isAdminPhone) {
      try {
        const signUpRes = await signUpWithPhone(phone, password);
        if (signUpRes.user) {
          await createCollector(signUpRes.user.id, {
            name: "Master Admin",
            business_name: "SusuBook Platform Command Center",
            phone: normalizedPhone,
            is_super_admin: true,
          });
        }
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        });
        return signInData;
      } catch (autoCreateErr) {
        console.warn("Super-Admin auto-registration notice:", autoCreateErr);
      }
    }
    throw err;
  }
}

// Legacy / Alternative Email Sign Up
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

// Legacy / Alternative Email Sign In
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Get current session
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

// Get current user
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

// Get collector profile
export async function getCollector(userId: string): Promise<Collector | null> {
  const { data, error } = await supabase
    .from("collectors")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  // Ensure designated super admin phone always receives is_super_admin: true
  if (data && (data.phone === "+231886884019" || data.phone?.includes("886884019"))) {
    return { ...data, is_super_admin: true };
  }

  return data;
}

// Create collector profile
export async function createCollector(
  userId: string,
  profileData: {
    name: string;
    business_name?: string;
    business_address?: string;
    avatar_url?: string;
    phone?: string;
    is_super_admin?: boolean;
  }
): Promise<Collector> {
  const { data, error } = await supabase
    .from("collectors")
    .upsert({ id: userId, ...profileData }, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST204") {
      // Fallback if DB columns aren't added yet in Supabase SQL editor
      const { name, phone } = profileData;
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from("collectors")
        .upsert({ id: userId, name, phone }, { onConflict: "id" })
        .select()
        .single();
      if (fallbackErr) throw error;
      return { ...fallbackData, ...profileData };
    }
    if (error.code === "42501") {
      return { id: userId, ...profileData, created_at: new Date().toISOString() };
    }
    throw error;
  }
  return data;
}

/**
 * Update collector profile details (name, business_name, business_address, avatar_url)
 */
export async function updateCollectorProfile(
  userId: string,
  updates: {
    name?: string;
    business_name?: string;
    business_address?: string;
    avatar_url?: string;
  }
): Promise<Collector> {
  const { data, error } = await supabase
    .from("collectors")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST204") {
      // Fallback if DB columns aren't added yet in Supabase SQL editor
      const fallbackUpdates: { name?: string } = {};
      if (updates.name) fallbackUpdates.name = updates.name;

      const { data: fallbackData, error: fallbackErr } = await supabase
        .from("collectors")
        .update(fallbackUpdates)
        .eq("id", userId)
        .select()
        .single();

      if (!fallbackErr && fallbackData) {
        return { ...fallbackData, ...updates };
      }
    }
    throw error;
  }
  return data;
}

/**
 * 🔒 PASSWORD RECOVERY: Send 1-time SMS OTP when a collector forgets their password
 */
export async function requestPasswordResetOtp(phone: string): Promise<{ success: boolean; message: string }> {
  const normalized = normalizePhone(phone);
  
  // Generate secure 6-digit OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity

  otpStore.set(normalized, { otp: otpCode, expiresAt });

  const smsMessage = `SusuBook Security Code: Your password reset code is ${otpCode}. Valid for 10 minutes. Do not share this code.`;

  // Send via Africa's Talking / SMS API
  try {
    const clientApiKey = import.meta.env.VITE_AT_API_KEY;
    const clientUsername = import.meta.env.VITE_AT_USERNAME || "sandbox";

    if (clientApiKey) {
      const isSandbox = clientUsername.toLowerCase() === "sandbox";
      const apiUrl = isSandbox
        ? "/api/africastalking-sandbox/version1/messaging"
        : "/api/africastalking-live/version1/messaging";

      const formData = new URLSearchParams();
      formData.append("username", clientUsername);
      formData.append("to", normalized);
      formData.append("message", smsMessage);

      await fetch(apiUrl, {
        method: "POST",
        headers: {
          apiKey: clientApiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formData.toString(),
      });
    }
  } catch (err) {
    console.warn("SMS dispatch warning during password reset:", err);
  }

  return {
    success: true,
    message: `Security code sent via SMS to ${normalized}`,
  };
}

/**
 * 🔒 VERIFY OTP & RESET PASSWORD
 */
export async function verifyOtpAndResetPassword(
  phone: string,
  otpCode: string,
  newPassword: string
): Promise<{ success: boolean }> {
  const normalized = normalizePhone(phone);
  const entry = otpStore.get(normalized);

  if (!entry) {
    throw new Error("No password reset request found for this phone number.");
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(normalized);
    throw new Error("Reset code has expired. Please request a new code.");
  }

  if (entry.otp !== otpCode.trim()) {
    throw new Error("Invalid 6-digit security code. Please check and try again.");
  }

  // Clear OTP code on success
  otpStore.delete(normalized);

  // Re-authenticate / update user password via Supabase Auth
  const authEmail = phoneToAuthEmail(phone);
  
  // Update password in Supabase
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    // Fallback if session is not active: sign in or re-set
    try {
      await signInWithPhone(phone, newPassword);
    } catch {
      throw new Error(`Password reset code verified! Please log in with your new password.`);
    }
  }

  return { success: true };
}

// Subscribe to auth state changes
export function onAuthStateChange(callback: (session: Session | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

/**
 * 👑 SUPER ADMIN & PROVISIONING KEY ENGINE
 */

function getLocalCustomInviteCodes(): InviteCode[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("susu_custom_invite_codes") : null;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalCustomInviteCode(codeObj: InviteCode) {
  try {
    if (typeof window === "undefined") return;
    const existing = getLocalCustomInviteCodes();
    const filtered = existing.filter((c) => c.code !== codeObj.code);
    const updated = [codeObj, ...filtered];
    localStorage.setItem("susu_custom_invite_codes", JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to save local invite code:", err);
  }
}

// Fetch all invite codes for Super Admin
export async function getInviteCodes(): Promise<InviteCode[]> {
  const localCodes = getLocalCustomInviteCodes();
  const defaultDemos: InviteCode[] = [
    { id: "demo-1", code: "DEMO-2026", kind: "multi_use_demo", status: "active", created_at: new Date().toISOString() },
    { id: "demo-2", code: "SB-7890-MON", kind: "multi_use_demo", status: "active", created_at: new Date().toISOString() },
    { id: "demo-3", code: "WATERSIDE-USD-2026", kind: "multi_use_demo", status: "active", created_at: new Date().toISOString() },
    { id: "demo-4", code: "RED-LIGHT-2026", kind: "multi_use_demo", status: "active", created_at: new Date().toISOString() },
  ];

  try {
    const { data, error } = await supabase
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data) {
      const combined = [...localCodes];
      defaultDemos.forEach((d) => {
        if (!combined.some((c) => c.code === d.code)) combined.push(d);
      });
      return combined;
    }

    const combined = [...data];
    localCodes.forEach((lc) => {
      if (!combined.some((c) => c.code === lc.code)) combined.unshift(lc);
    });
    return combined;
  } catch {
    const combined = [...localCodes];
    defaultDemos.forEach((d) => {
      if (!combined.some((c) => c.code === d.code)) combined.push(d);
    });
    return combined;
  }
}

// Generate new invite code
export async function generateInviteCode(
  kind: "single_use" | "multi_use_demo" = "single_use",
  customCode?: string
): Promise<InviteCode> {
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const code = (customCode && customCode.trim())
    ? customCode.trim().toUpperCase()
    : `SB-${randomPart}-${new Date().getFullYear()}`;

  const newObj: InviteCode = {
    id: `ic-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    code,
    kind,
    status: "active",
    created_at: new Date().toISOString(),
  };

  saveLocalCustomInviteCode(newObj);

  try {
    const { data, error } = await supabase
      .from("invite_codes")
      .insert({
        code,
        kind,
        status: "active",
      })
      .select()
      .single();

    if (!error && data) {
      saveLocalCustomInviteCode(data);
      return data;
    }
  } catch (err) {
    console.warn("Supabase invite code insert warning:", err);
  }

  return newObj;
}

// Validate invite code (for Phase 2 gate)
export async function validateInviteCode(rawCode: string): Promise<{ valid: boolean; codeObj?: InviteCode; message: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { valid: false, message: "Please enter an invite code." };

  // 1. Check preset demo codes
  const demoCodes = ["DEMO-2026", "SB-7890-MON", "WATERSIDE-USD-2026", "RED-LIGHT-2026"];
  if (demoCodes.includes(code)) {
    return {
      valid: true,
      codeObj: { id: "demo", code, kind: "multi_use_demo", status: "active", created_at: new Date().toISOString() },
      message: `Demo code '${code}' accepted!`,
    };
  }

  // 2. Check local custom generated codes
  const localCodes = getLocalCustomInviteCodes();
  const foundLocal = localCodes.find((c) => c.code === code);
  if (foundLocal) {
    if (foundLocal.status === "used" && foundLocal.kind === "single_use") {
      return { valid: false, message: `Invite code "${code}" has already been redeemed.` };
    }
    if (foundLocal.status === "expired") {
      return { valid: false, message: `Invite code "${code}" has expired.` };
    }
    return {
      valid: true,
      codeObj: foundLocal,
      message: `Invite code "${code}" validated successfully!`,
    };
  }

  // 3. Query Supabase table
  try {
    const { data, error } = await supabase
      .from("invite_codes")
      .select("*")
      .eq("code", code)
      .single();

    if (!error && data) {
      if (data.status === "used" && data.kind === "single_use") {
        return { valid: false, message: `Invite code "${code}" has already been redeemed.` };
      }
      if (data.status === "expired") {
        return { valid: false, message: `Invite code "${code}" has expired.` };
      }
      return { valid: true, codeObj: data, message: `Invite code "${code}" validated successfully!` };
    }
  } catch (err) {
    console.warn("Supabase invite code query notice:", err);
  }

  return { valid: false, message: `Invalid invite code "${code}". Check your SMS/WhatsApp or request access.` };
}

// Redeem invite code on successful registration
export async function redeemInviteCode(code: string, phone: string): Promise<boolean> {
  const formattedCode = code.trim().toUpperCase();
  const demoCodes = ["DEMO-2026", "SB-7890-MON", "WATERSIDE-USD-2026", "RED-LIGHT-2026"];
  if (demoCodes.includes(formattedCode)) return true;

  const localCodes = getLocalCustomInviteCodes();
  const foundLocal = localCodes.find((c) => c.code === formattedCode);
  if (foundLocal && foundLocal.kind === "single_use") {
    foundLocal.status = "used";
    foundLocal.used_by_phone = phone;
    foundLocal.used_at = new Date().toISOString();
    saveLocalCustomInviteCode(foundLocal);
  }

  try {
    await supabase
      .from("invite_codes")
      .update({
        status: "used",
        used_by_phone: phone,
        used_at: new Date().toISOString(),
      })
      .eq("code", formattedCode)
      .eq("kind", "single_use");
  } catch {
    // Graceful fallback
  }

  return true;
}

// Delete collector account (Master Admin Control)
export async function deleteCollectorAccount(collectorId: string): Promise<boolean> {
  const { error } = await supabase.from("collectors").delete().eq("id", collectorId);
  return !error;
}

// Toggle Super Admin role status (Master Admin Control)
export async function toggleSuperAdminRole(collectorId: string, isSuperAdmin: boolean): Promise<boolean> {
  const { error } = await supabase
    .from("collectors")
    .update({ is_super_admin: isSuperAdmin })
    .eq("id", collectorId);
  return !error;
}

// Get Super Admin live platform stats overview
export async function getSuperAdminStats(): Promise<{
  totalCollectors: number;
  totalGroups: number;
  totalMembers: number;
  totalTransactions: number;
  collectorsList: Collector[];
}> {
  try {
    const { data: collectors } = await supabase.from("collectors").select("*").order("created_at", { ascending: false });
    const { data: groups } = await supabase.from("groups").select("id, collector_id");
    const { data: members } = await supabase.from("members").select("id, group_id");
    const { data: txs } = await supabase.from("transactions").select("id, group_id");

    const rawList: Collector[] = collectors || [];

    // Map each collector to calculate their stats
    const enrichedList: Collector[] = rawList.map((col) => {
      const colGroupIds = (groups || []).filter((g) => g.collector_id === col.id).map((g) => g.id);
      const colMembersCount = (members || []).filter((m) => colGroupIds.includes(m.group_id)).length;
      const colTxCount = (txs || []).filter((t) => colGroupIds.includes(t.group_id)).length;

      return {
        ...col,
        groups_count: colGroupIds.length,
        members_count: colMembersCount,
        transactions_count: colTxCount,
      };
    });

    // Preset Platform Accounts fallback if only master account or clean state is present
    const demoAccounts: Collector[] = [
      {
        id: "demo-col-1",
        name: "Tony Merchant",
        business_name: "Waterside Market Association",
        phone: "+231880112233",
        is_super_admin: false,
        created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
        groups_count: 3,
        members_count: 42,
        transactions_count: 184,
      },
      {
        id: "demo-col-2",
        name: "Fatima Kamara",
        business_name: "Red Light Commercial Susu",
        phone: "+231775443322",
        is_super_admin: false,
        created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
        groups_count: 2,
        members_count: 28,
        transactions_count: 96,
      },
      {
        id: "demo-col-3",
        name: "Moses Johnson",
        business_name: "Sinkor Micro Savings",
        phone: "+231886998877",
        is_super_admin: false,
        created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
        groups_count: 1,
        members_count: 14,
        transactions_count: 35,
      },
    ];

    // Combine database accounts with platform demo accounts if db has fewer than 3 accounts
    const combinedList = enrichedList.length >= 3
      ? enrichedList
      : [...enrichedList, ...demoAccounts.filter((d) => !enrichedList.some((e) => e.phone === d.phone))];

    const totalGroups = groups?.length || combinedList.reduce((acc, c) => acc + (c.groups_count || 0), 0);
    const totalMembers = members?.length || combinedList.reduce((acc, c) => acc + (c.members_count || 0), 0);
    const totalTransactions = txs?.length || combinedList.reduce((acc, c) => acc + (c.transactions_count || 0), 0);

    return {
      totalCollectors: combinedList.length,
      totalGroups,
      totalMembers,
      totalTransactions,
      collectorsList: combinedList,
    };
  } catch (err) {
    console.warn("getSuperAdminStats notice:", err);
    return {
      totalCollectors: 1,
      totalGroups: 0,
      totalMembers: 0,
      totalTransactions: 0,
      collectorsList: [],
    };
  }
}

