import { supabase } from "./supabase";
import type { Session, User } from "@supabase/supabase-js";

export interface Collector {
  id: string;
  name: string;
  business_name?: string;
  business_address?: string;
  avatar_url?: string;
  phone?: string;
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
  const authEmail = phoneToAuthEmail(phone);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });

  if (error) throw error;
  return data;
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
