import { useAuth } from "./contexts/AuthContext";
import Login from "./screens/Login";
import Onboarding from "./screens/Onboarding";
import App from "./App";

export default function AppRoot() {
  const { user, collector, loading, refreshCollector } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-2xl">💰</span>
          </div>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → Show Login
  if (!user) {
    return <Login onSuccess={refreshCollector} />;
  }

  // Logged in, but no profile or placeholder name -> Show Onboarding
  const needsOnboarding = !collector || !collector.name || collector.name === "Collector" || collector.name.startsWith("collector231");

  if (needsOnboarding) {
    return <Onboarding userId={user.id} onComplete={refreshCollector} />;
  }

  // Logged in with completed profile → Show the existing App
  return <App collectorName={collector.name} />;
}
