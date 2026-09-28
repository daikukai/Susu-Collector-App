import { useAuth } from "./contexts/AuthContext";
import Login from "./screens/Login";
import Onboarding from "./screens/Onboarding";
import App from "./App";
import { PWAInstallBanner } from "./components/PWAInstallBanner";

export default function AppRoot() {
  const { user, collector, loading, refreshCollector, signOut } = useAuth();

  const isNewSignup = typeof window !== "undefined" && sessionStorage.getItem("susu_is_new_signup") === "true";

  const isSuperAdminUser = user && (user.phone === "+231886884019" || user.user_metadata?.phone === "+231886884019");

  return (
    <>
      <PWAInstallBanner />
      {loading ? (
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <span className="text-2xl">💰</span>
            </div>
            <p className="text-sm text-gray-500">Loading...</p>
          </div>
        </div>
      ) : !user ? (
        <Login onSuccess={refreshCollector} />
      ) : !collector && !isSuperAdminUser && !isNewSignup ? (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-md w-full shadow-2xl">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">
              🔒
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Invitation Access Required</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Your account has not been authorized with a redeemed invitation access key. Direct registration outside the invitation workflow is restricted.
            </p>
            <div className="space-y-3">
              <a
                href={`https://wa.me/231778445619?text=${encodeURIComponent("Hello Admin, I need an invitation access key for SusuBook.")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all text-center"
              >
                💬 Request Invitation Key via Admin WhatsApp
              </a>
              <button
                onClick={() => signOut()}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition-all"
              >
                Return to Login Gate
              </button>
            </div>
          </div>
        </div>
      ) : isNewSignup ? (
        <Onboarding
          userId={user.id}
          onComplete={() => {
            sessionStorage.removeItem("susu_is_new_signup");
            refreshCollector();
          }}
        />
      ) : (
        <App collectorName={collector?.name || "Collector"} />
      )}
    </>
  );
}

