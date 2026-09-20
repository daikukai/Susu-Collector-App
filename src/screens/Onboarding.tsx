import { useState } from "react";
import { createCollector } from "../lib/auth";

interface OnboardingProps {
  userId: string;
  onComplete: () => void;
}

const PRESET_AVATARS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
];

export default function Onboarding({ userId, onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(PRESET_AVATARS[0]);
  const [currency, setCurrency] = useState("LRD");
  const [role, setRole] = useState("Independent Collector");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter your personal full name.");
      return;
    }

    setLoading(true);

    try {
      await createCollector(userId, {
        name: name.trim(),
        business_name: businessName.trim() || name.trim() + " Susu Services",
        business_address: businessAddress.trim(),
        avatar_url: avatarUrl,
      });
      onComplete();
    } catch (err: any) {
      console.error("Onboarding error:", err);
      setError(err.message || "Failed to create collector profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-100/60 to-emerald-200 flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-3xl shadow-xl border border-emerald-100/60 p-6 md:p-8 transition-all">
          {/* Logo & Header */}
          <div className="flex flex-col items-center justify-center mb-6">
            <img
              src="/logo.png"
              alt="SusuBook Logo"
              className="w-16 h-16 rounded-2xl shadow-md object-contain mb-1.5 hover:scale-105 transition-transform"
            />
            <span className="text-2xl font-black bg-gradient-to-r from-emerald-800 to-emerald-600 bg-clip-text text-transparent tracking-tight">
              SusuBook
            </span>
            <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-700 mt-0.5">
              Collector Registration & Profile Setup
            </span>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-800 mb-1">
              Setup Your Collector Profile 👤
            </h1>
            <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
              Enter your personal details, business info, and profile photo for member receipts & group management.
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-2">
              <span className="text-red-500 text-sm">⚠️</span>
              <p className="text-xs text-red-600 font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Avatar / Photo Picker */}
            <div className="flex flex-col items-center justify-center pb-2">
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Profile Photo / Avatar
              </label>
              <div className="relative group">
                <img
                  src={avatarUrl}
                  alt="Collector Profile"
                  className="w-20 h-20 rounded-full object-cover border-4 border-emerald-400 shadow-md transition-transform group-hover:scale-105"
                />
                <label className="absolute bottom-0 right-0 bg-emerald-600 text-white text-[10px] font-bold p-1.5 rounded-full shadow-md cursor-pointer hover:bg-emerald-700 transition-colors">
                  📷
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Preset Avatars */}
              <div className="flex space-x-2 mt-3">
                {PRESET_AVATARS.map((url, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatarUrl(url)}
                    className={`w-7 h-7 rounded-full overflow-hidden border-2 transition-transform hover:scale-110 ${
                      avatarUrl === url ? "border-emerald-600 ring-2 ring-emerald-200 scale-110" : "border-transparent"
                    }`}
                  >
                    <img src={url} alt={`Avatar ${idx}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            {/* Personal Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Collector's Personal Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah Jenkins"
                required
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-4 py-2.5 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-medium"
              />
            </div>

            {/* Business Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Business / Agency Name
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Jenkins Susu & Credit Enterprise"
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-4 py-2.5 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-medium"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">
                Displays on official receipts and printed Susu cards.
              </p>
            </div>

            {/* Business Address */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Business / Office / Market Address
              </label>
              <input
                type="text"
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                placeholder="e.g. Waterside Market, Block B, Store #14, Monrovia"
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-4 py-2.5 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-medium"
              />
            </div>

            {/* Operating Currency & Category */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Primary Currency
                </label>
                <div className="flex space-x-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrency("LRD")}
                    className={`flex-1 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                      currency === "LRD"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-100"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    🇱🇷 LRD
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrency("USD")}
                    className={`flex-1 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                      currency === "USD"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-100"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    🇺🇸 USD
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Collector Category
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 font-medium"
                >
                  <option value="Independent Collector">Independent Collector</option>
                  <option value="Market Union Collector">Market Women / Union</option>
                  <option value="Community / Church Savings">Church / Group Savings</option>
                  <option value="Small Business / Shop Owner">Shop / Enterprise Owner</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-bold text-sm py-3.5 rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-emerald-200 mt-2"
            >
              {loading ? "Saving Profile..." : "Complete Profile & Launch Dashboard 🚀"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
