import { useState } from "react";
import {
  signInWithPhone,
  signUpWithPhone,
  requestPasswordResetOtp,
  verifyOtpAndResetPassword,
  validateInviteCode,
  redeemInviteCode,
  InviteCode,
} from "../lib/auth";

interface LoginProps {
  onSuccess: () => void;
}

type AuthMode = "invite_gate" | "sign_in" | "sign_up";

export default function Login({ onSuccess }: LoginProps) {
  const [mode, setMode] = useState<AuthMode>("sign_in");

  // Form input states
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Invite Access Gate States
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [validatingInvite, setValidatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [validatedCodeObj, setValidatedCodeObj] = useState<InviteCode | null>(null);

  // Status & Feedback Messages
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Password Recovery Modal States
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState<"phone" | "otp">("phone");
  const [resetPhone, setResetPhone] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");

  // Quick Preset Invite Codes for Demo/Testing
  const PRESET_INVITE_CODES = ["SB-7890-MON", "RED-LIGHT-2026", "WATERSIDE-USD-2026", "DEMO-2026"];

  const handleUnlockAccess = async (codeOverride?: string) => {
    const codeToValidate = (codeOverride || inviteCodeInput).trim().toUpperCase();
    setInviteError("");
    setError("");

    if (!codeToValidate) {
      setInviteError("Please enter your invitation code to proceed.");
      return;
    }

    setValidatingInvite(true);

    try {
      const res = await validateInviteCode(codeToValidate);
      if (!res.valid) {
        setInviteError(
          `We couldn't verify code "${codeToValidate}". Please check your WhatsApp invitation message or contact your platform administrator.`
        );
      } else {
        setValidatedCodeObj(res.codeObj || { id: "demo", code: codeToValidate, kind: "multi_use_demo", status: "active", created_at: new Date().toISOString() });
        setSuccessMsg(`Access invitation code "${codeToValidate}" verified! Complete your collector account registration below.`);
        setMode("sign_up");
      }
    } catch (err: any) {
      setInviteError(err.message || "Failed to verify invitation code. Please try again.");
    } finally {
      setValidatingInvite(false);
    }
  };

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (mode === "sign_up") {
      if (!validatedCodeObj) {
        setMode("invite_gate");
        setInviteError("An invitation code is required to create a new account.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match. Please re-enter your password.");
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "sign_up") {
        try {
          await signUpWithPhone(phone, password);
          // Burn / redeem invite code upon successful registration
          if (validatedCodeObj?.code) {
            await redeemInviteCode(validatedCodeObj.code, phone);
          }
        } catch (signUpErr: any) {
          if (signUpErr.message?.toLowerCase().includes("rate limit") || signUpErr.status === 429) {
            try {
              await signInWithPhone(phone, password);
              onSuccess();
              return;
            } catch {
              throw new Error("Security rate limit reached for new account creation. Please try signing in, or wait a few minutes.");
            }
          }
          throw signUpErr;
        }
      } else {
        await signInWithPhone(phone, password);
      }
      onSuccess();
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message || "Authentication failed. Please check your phone number and password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");
    setResetSuccess("");
    setResetLoading(true);

    try {
      const res = await requestPasswordResetOtp(resetPhone);
      setResetSuccess(res.message);
      setResetStep("otp");
    } catch (err: any) {
      setResetError(err.message || "Failed to send reset code. Verify phone number.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyOtpAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");
    setResetSuccess("");

    if (newPassword !== confirmNewPassword) {
      setResetError("New passwords do not match. Please re-enter.");
      return;
    }

    setResetLoading(true);

    try {
      await verifyOtpAndResetPassword(resetPhone, resetOtp, newPassword);
      setResetSuccess("Password reset successfully! You can now log in.");
      setTimeout(() => {
        setShowResetModal(false);
        setResetStep("phone");
        setPhone(resetPhone);
        setPassword(newPassword);
        setMode("sign_in");
        setSuccessMsg("Password reset! Sign in with your new password below.");
      }, 1800);
    } catch (err: any) {
      setResetError(err.message || "Failed to reset password.");
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-slate-800/80 p-8 transition-all">
          
          {/* Brand Header */}
          <div className="flex flex-col items-center justify-center mb-6 text-center">
            <img
              src="/logo.png"
              alt="SusuBook Logo"
              className="w-20 h-20 rounded-2xl shadow-lg object-contain mb-3 border border-emerald-500/20 p-1 bg-slate-950"
            />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-200 bg-clip-text text-transparent tracking-tight">
                SusuBook
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Exclusive Access
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-xs font-medium">
              Liberia's trusted digital ledger for professional Susu collectors & savings groups
            </p>
          </div>

          {/* Alert Error / Success Messages */}
          {error && (
            <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-2 text-rose-400 text-xs font-medium leading-relaxed">
              <span className="text-base">⚠️</span>
              <p>{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-2 text-emerald-400 text-xs font-medium leading-relaxed">
              <span className="text-base">✅</span>
              <p>{successMsg}</p>
            </div>
          )}

          {/* MODE 1: INVITATION GATEWAY (Default Landing Page) */}
          {mode === "invite_gate" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h2 className="text-lg font-bold text-white">Welcome to SusuBook</h2>
                <p className="text-xs text-slate-400">
                  Please enter your invitation code to access the collector portal
                </p>
              </div>

              {inviteError && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-300 text-xs leading-relaxed font-medium">
                  {inviteError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">
                    Have an invitation code?
                  </label>
                  <input
                    type="text"
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                    placeholder="e.g. DEMO-TONY-2026"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-2xl px-4 py-3.5 text-center text-base font-mono tracking-wider text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 uppercase transition-all shadow-inner"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleUnlockAccess()}
                  disabled={validatingInvite}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm py-3.5 rounded-2xl active:scale-[0.98] disabled:opacity-50 transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                >
                  {validatingInvite ? (
                    "Verifying Invitation Code..."
                  ) : (
                    <>
                      <span>Unlock My Access</span>
                      <span className="text-base">→</span>
                    </>
                  )}
                </button>

                {/* Preset Demo Invitation Codes */}
                <div className="pt-2">
                  <p className="text-[11px] font-medium text-slate-500 mb-2 text-center">
                    Try Preset Invitation Codes:
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {PRESET_INVITE_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          setInviteCodeInput(code);
                          handleUnlockAccess(code);
                        }}
                        className="px-2.5 py-1 bg-slate-950 hover:bg-emerald-950/50 border border-slate-800 hover:border-emerald-500/50 text-slate-400 hover:text-emerald-300 rounded-xl text-xs font-mono transition-all"
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Already Registered Sign In Redirect */}
              <div className="pt-4 border-t border-slate-800/80 text-center">
                <p className="text-xs text-slate-400">
                  Already a SusuBook Collector?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("sign_in");
                      setError("");
                      setSuccessMsg("");
                      setInviteError("");
                    }}
                    className="text-emerald-400 font-bold hover:underline"
                  >
                    Sign In to Your Dashboard
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* MODE 2: SIGN IN FORM */}
          {mode === "sign_in" && (
            <form onSubmit={handleSubmitAuth} className="space-y-4">
              <div className="text-center mb-4">
                <h2 className="text-xl font-bold text-white">Collector Sign In</h2>
                <p className="text-xs text-slate-400">Enter your registered phone number & password</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-xs font-bold text-emerald-400">
                    🇱🇷 +231
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0886 884 019"
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-20 pr-4 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Password / PIN
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetPhone(phone);
                      setResetError("");
                      setResetSuccess("");
                      setShowResetModal(true);
                    }}
                    className="text-xs text-emerald-400 font-medium hover:underline"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-12 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? "🙈 Hide" : "👁️ Show"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm py-3.5 rounded-xl active:scale-[0.98] disabled:opacity-50 transition-all shadow-md shadow-emerald-600/20"
              >
                {loading ? "Signing In..." : "Sign In to Dashboard"}
              </button>

              <div className="pt-4 border-t border-slate-800/80 text-center space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("invite_gate");
                    setError("");
                    setSuccessMsg("");
                  }}
                  className="w-full bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 font-semibold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2"
                >
                  <span>🔑</span>
                  <span>Have an Invitation Code? Enter Key</span>
                </button>
                <p className="text-[11px] text-slate-500">
                  Public signups disabled. New accounts require an admin invitation code.
                </p>
              </div>
            </form>
          )}

          {/* MODE 3: VETTED REGISTRATION FORM (UNLOCKED AFTER CODE VERIFICATION) */}
          {mode === "sign_up" && (
            <form onSubmit={handleSubmitAuth} className="space-y-4">
              <div className="text-center mb-4">
                <h2 className="text-xl font-bold text-white">Create Collector Account</h2>
                <p className="text-xs text-slate-400">Register your phone number to manage savings groups</p>
              </div>

              {/* Verified Code Badge */}
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">🔐</span>
                  <div>
                    <p className="text-xs font-bold text-emerald-300">Invitation Verified</p>
                    <p className="text-[10px] text-emerald-400 font-mono">{validatedCodeObj?.code}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Approved
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-xs font-bold text-emerald-400">
                    🇱🇷 +231
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0886 884 019"
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-20 pr-4 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Password / PIN
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-12 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? "🙈 Hide" : "👁️ Show"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Confirm Password / PIN
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-12 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? "🙈 Hide" : "👁️ Show"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm py-3.5 rounded-xl active:scale-[0.98] disabled:opacity-50 transition-all shadow-md shadow-emerald-600/20"
              >
                {loading ? "Creating Account..." : "Complete Registration"}
              </button>

              <div className="pt-4 border-t border-slate-800/80 text-center">
                <button
                  type="button"
                  onClick={() => setMode("invite_gate")}
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Change Invitation Code
                </button>
              </div>
            </form>
          )}

        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-500 mt-6 font-medium">
          🔒 Powered by SusuBook • Secure Multi-Tenant Collector Network
        </p>
      </div>

      {/* 🔒 FORGOT PASSWORD / SMS OTP RESET MODAL */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-lg">🔐</span>
                <h3 className="font-bold text-white text-base">Reset Password</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="text-slate-400 hover:text-white text-sm font-bold w-8 h-8 rounded-full hover:bg-slate-800 flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {resetError && (
              <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <p className="text-xs text-rose-400 font-medium">{resetError}</p>
              </div>
            )}

            {resetSuccess && (
              <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <p className="text-xs text-emerald-400 font-medium">{resetSuccess}</p>
              </div>
            )}

            {resetStep === "phone" ? (
              <form onSubmit={handleSendResetOtp} className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enter your registered phone number. We will send a 1-time security code via SMS to reset your password.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Registered Phone Number
                  </label>
                  <input
                    type="tel"
                    value={resetPhone}
                    onChange={(e) => setResetPhone(e.target.value)}
                    placeholder="0886 884 019"
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl px-4 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="w-1/3 bg-slate-800 text-slate-300 font-semibold text-xs py-3 rounded-xl hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-2/3 bg-emerald-600 text-white font-bold text-xs py-3 rounded-xl hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {resetLoading ? "Sending SMS..." : "Send Reset Code"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtpAndReset} className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enter the security code sent to <strong className="text-slate-200">{resetPhone}</strong> and set your new password.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    6-Digit SMS Security Code
                  </label>
                  <input
                    type="text"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value)}
                    placeholder="e.g. 849201"
                    required
                    maxLength={6}
                    className="w-full bg-slate-950 border border-emerald-500/50 text-emerald-400 text-center text-lg font-mono font-bold rounded-xl px-4 py-2.5 tracking-widest focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    New Password / PIN
                  </label>
                  <div className="relative">
                    <input
                      type={showResetPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-12 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-slate-500 hover:text-slate-300"
                    >
                      {showResetPassword ? "🙈 Hide" : "👁️ Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showResetPassword ? "text" : "password"}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-12 py-3 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-slate-500 hover:text-slate-300"
                    >
                      {showResetPassword ? "🙈 Hide" : "👁️ Show"}
                    </button>
                  </div>
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetStep("phone")}
                    className="w-1/3 bg-slate-800 text-slate-300 font-semibold text-xs py-3 rounded-xl hover:bg-slate-700"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-2/3 bg-emerald-600 text-white font-bold text-xs py-3 rounded-xl hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {resetLoading ? "Resetting..." : "Reset Password & Sign In"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
