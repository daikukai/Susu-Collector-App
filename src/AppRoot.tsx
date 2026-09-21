import { useAuth } from "./contexts/AuthContext";
import Login from "./screens/Login";
import Onboarding from "./screens/Onboarding";
import App from "./App";
import { PWAInstallBanner } from "./components/PWAInstallBanner";

export default function AppRoot() {
  const { user, collector, loading, refreshCollector } = useAuth();

  const isNewSignup = typeof window !== "undefined" && sessionStorage.getItem("susu_is_new_signup") === "true";

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

