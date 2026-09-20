import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { updateCollectorProfile } from "../lib/auth";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_AVATARS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
];

export default function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { user, collector, refreshCollector, signOut } = useAuth();
  
  const [name, setName] = useState(collector?.name || "");
  const [businessName, setBusinessName] = useState(collector?.business_name || "");
  const [businessAddress, setBusinessAddress] = useState(collector?.business_address || "");
  const [avatarUrl, setAvatarUrl] = useState(collector?.avatar_url || PRESET_AVATARS[0]);
  const [currency, setCurrency] = useState("LRD");
  const [role, setRole] = useState("Independent Field Collector");

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (collector) {
      setName(collector.name || "");
      setBusinessName(collector.business_name || "");
      setBusinessAddress(collector.business_address || "");
      if (collector.avatar_url) setAvatarUrl(collector.avatar_url);
    }
  }, [collector, isOpen]);

  if (!isOpen) return null;

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError("");
    setSuccess("");

    if (!name.trim()) {
      setError("Please enter your personal full name.");
      return;
    }

    setLoading(true);

    try {
      await updateCollectorProfile(user.id, {
        name: name.trim(),
        business_name: businessName.trim(),
        business_address: businessAddress.trim(),
        avatar_url: avatarUrl,
      });
      await refreshCollector();
      setSuccess("Profile updated successfully!");
      setTimeout(() => {
        setSuccess("");
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error("Failed to update profile:", err);
      setError(err.message || "Failed to update profile details.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    onClose();
    await signOut();
  };

  const registeredPhone = user?.user_metadata?.phone || user?.phone || "Registered Account";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-emerald-100 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <img
              src={avatarUrl}
              alt="Collector Profile"
              className="w-12 h-12 rounded-2xl object-cover border-2 border-emerald-400 shadow-md"
            />
            <div>
              <h2 className="font-bold text-gray-800 text-base">{name || "Collector Profile"}</h2>
              <p className="text-[11px] text-gray-500 font-mono">{registeredPhone}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center justify-center text-sm font-bold hover:bg-gray-200 transition-all"
          >
            ✕
          </button>
        </div>

        {/* Success & Error Alert */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-2">
            <span className="text-red-500 text-xs">⚠️</span>
            <p className="text-xs text-red-600 font-medium">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-2">
            <span className="text-emerald-600 text-xs">✅</span>
            <p className="text-xs text-emerald-700 font-medium">{success}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-4 mt-4">
          {/* Avatar / Photo Picker */}
          <div className="flex flex-col items-center justify-center pb-2 border-b border-gray-100">
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              Profile Photo / Avatar
            </label>
            <div className="relative group">
              <img
                src={avatarUrl}
                alt="Collector Profile"
                className="w-16 h-16 rounded-full object-cover border-3 border-emerald-400 shadow-md"
              />
              <label className="absolute bottom-0 right-0 bg-emerald-600 text-white text-[10px] font-bold p-1 rounded-full shadow-md cursor-pointer hover:bg-emerald-700 transition-colors">
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
            <div className="flex space-x-2 mt-2">
              {PRESET_AVATARS.map((url, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAvatarUrl(url)}
                  className={`w-6 h-6 rounded-full overflow-hidden border-2 transition-transform hover:scale-110 ${
                    avatarUrl === url ? "border-emerald-600 ring-2 ring-emerald-200 scale-110" : "border-transparent"
                  }`}
                >
                  <img src={url} alt={`Avatar ${idx}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Collector's Personal Name <span className="text-red-500">*</span>
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

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Business / Agency Name
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Jenkins Susu Services & Credit"
              className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-sm rounded-xl px-4 py-2.5 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 transition-all font-medium"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Appears on printed Susu cards and official member statements.
            </p>
          </div>

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

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Registered Phone Number
            </label>
            <input
              type="text"
              value={registeredPhone}
              disabled
              className="w-full bg-gray-100 border border-gray-200 text-gray-500 text-xs rounded-xl px-4 py-2 font-mono cursor-not-allowed"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Default Currency
              </label>
              <div className="flex space-x-1">
                <button
                  type="button"
                  onClick={() => setCurrency("LRD")}
                  className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all ${
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
                  className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all ${
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
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 font-medium"
              >
                <option value="Independent Field Collector">Independent Collector</option>
                <option value="Market Union Collector">Market Women / Union</option>
                <option value="Community / Church Savings">Church / Group Savings</option>
                <option value="Small Business / Shop Owner">Shop / Enterprise Owner</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between space-x-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="px-4 py-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl hover:bg-red-100 transition-colors flex items-center space-x-1.5"
            >
              <span>🚪 Sign Out</span>
            </button>

            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-100 hover:brightness-105 active:scale-[0.98] disabled:opacity-50 transition-all"
            >
              {loading ? "Saving Profile..." : "Save Profile Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
