import { useState } from "react";
import { signInWithPhone, signUpWithPhone, requestPasswordResetOtp, verifyOtpAndResetPassword } from "../lib/auth";

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Password Recovery States
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (isSignUp) {
      if (password !== confirmPassword) {
        setError("Passwords do not match. Please re-enter your password.");
        return;
      }
    }

    setLoading(true);

    try {
      if (isSignUp) {
        try {
          await signUpWithPhone(phone, password);
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
      setError(err.message || "Authentication failed. Please check your credentials.");
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
        setSuccessMsg("Password reset! Log in with your new password.");
      }, 1800);
    } catch (err: any) {
      setResetError(err.message || "Failed to reset password.");
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-100/50 to-emerald-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-xl border border-emerald-100/60 p-8 transition-all">
          {/* Logo/Icon */}
          <div className="flex flex-col items-center justify-center mb-6">
            <img
              src="/logo.png"
              alt="SusuBook Logo"
              className="w-20 h-20 rounded-2xl shadow-md object-contain mb-2 hover:scale-105 transition-transform"
            />
            <span className="text-2xl font-black bg-gradient-to-r from-emerald-800 to-emerald-600 bg-clip-text text-transparent tracking-tight">
              SusuBook
            </span>
            <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-700 mt-0.5">
              Collector Portal
            </span>
          </div>

          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800 mb-1.5">
              {isSignUp ? "Create Collector Account" : "Collector Sign In"}
            </h1>
            <p className="text-xs text-gray-500 max-w-xs mx-auto">
              {isSignUp
                ? "Register your phone number to start managing savings groups"
                : "Sign in with your registered phone number & password"}
            </p>
          </div>

          {/* Error & Success Messages */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-2">
              <span className="text-red-500 text-sm">⚠️</span>
              <p className="text-xs text-red-600 font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start space-x-2">
              <span className="text-emerald-600 text-sm">✅</span>
              <p className="text-xs text-emerald-700 font-medium leading-relaxed">{successMsg}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Phone Number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-xs font-bold text-emerald-700">
                  🇱🇷 +231
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0886 884 019"
                  required
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl pl-20 pr-4 py-3 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-mono"
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Enter your local MTN / Orange Liberia phone number
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-gray-600">
                  Password / PIN
                </label>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={() => {
                      setResetPhone(phone);
                      setResetError("");
                      setResetSuccess("");
                      setShowResetModal(true);
                    }}
                    className="text-xs text-emerald-600 font-semibold hover:text-emerald-700 hover:underline"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl pl-4 pr-12 py-3 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-gray-400 hover:text-gray-600 font-medium"
                >
                  {showPassword ? "🙈 Hide" : "👁️ Show"}
                </button>
              </div>
              {isSignUp && (
                <p className="text-[10px] text-gray-400 mt-1">
                  Must be at least 6 characters
                </p>
              )}
            </div>

            {/* Confirm Password Field on Sign Up */}
            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Confirm Password / PIN
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required={isSignUp}
                    minLength={6}
                    className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl pl-4 pr-12 py-3 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-gray-400 hover:text-gray-600 font-medium"
                  >
                    {showPassword ? "🙈 Hide" : "👁️ Show"}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-bold text-sm py-3.5 rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-emerald-200"
            >
              {loading ? "Verifying Credentials..." : isSignUp ? "Create Collector Account" : "Sign In to Dashboard"}
            </button>
          </form>

          {/* Toggle */}
          <div className="mt-6 text-center border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
                setSuccessMsg("");
              }}
              className="text-xs text-gray-600 font-medium hover:text-emerald-700 transition-colors"
            >
              {isSignUp ? (
                <>Already registered? <span className="text-emerald-600 font-bold">Sign In</span></>
              ) : (
                <>New Collector? <span className="text-emerald-600 font-bold">Create an Account</span></>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-500 mt-6 font-medium">
          🔒 Secure Multi-Tenant Ledger · SusuBook Platform
        </p>
      </div>

      {/* 🔒 FORGOT PASSWORD / SMS OTP RESET MODAL */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-emerald-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-lg">🔐</span>
                <h3 className="font-bold text-gray-800 text-base">Reset Password</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {resetError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-xs text-red-600 font-medium">{resetError}</p>
              </div>
            )}

            {resetSuccess && (
              <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-xs text-emerald-700 font-medium">{resetSuccess}</p>
              </div>
            )}

            {resetStep === "phone" ? (
              <form onSubmit={handleSendResetOtp} className="space-y-4">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Enter your registered phone number. We will send a 1-time 6-digit security code via SMS to reset your password.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Registered Phone Number
                  </label>
                  <input
                    type="tel"
                    value={resetPhone}
                    onChange={(e) => setResetPhone(e.target.value)}
                    placeholder="0886 884 019"
                    required
                    className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-4 py-3 placeholder-gray-400 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="w-1/3 bg-gray-100 text-gray-600 font-semibold text-xs py-3 rounded-xl hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-2/3 bg-emerald-600 text-white font-bold text-xs py-3 rounded-xl hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {resetLoading ? "Sending SMS..." : "Send SMS Reset Code"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtpAndReset} className="space-y-4">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Enter the 6-digit security code sent to <strong className="text-gray-700">{resetPhone}</strong> and set your new password.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    6-Digit SMS Security Code
                  </label>
                  <input
                    type="text"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value)}
                    placeholder="e.g. 849201"
                    required
                    maxLength={6}
                    className="w-full bg-gray-50 border border-emerald-300 text-emerald-800 text-center text-lg font-mono font-bold rounded-xl px-4 py-2.5 tracking-widest focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
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
                      className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl pl-4 pr-12 py-3 placeholder-gray-400 focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-gray-400 hover:text-gray-600 font-medium"
                    >
                      {showResetPassword ? "🙈 Hide" : "👁️ Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
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
                      className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl pl-4 pr-12 py-3 placeholder-gray-400 focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-gray-400 hover:text-gray-600 font-medium"
                    >
                      {showResetPassword ? "🙈 Hide" : "👁️ Show"}
                    </button>
                  </div>
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetStep("phone")}
                    className="w-1/3 bg-gray-100 text-gray-600 font-semibold text-xs py-3 rounded-xl hover:bg-gray-200"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-2/3 bg-emerald-600 text-white font-bold text-xs py-3 rounded-xl hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {resetLoading ? "Resetting..." : "Reset Password & Login"}
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
