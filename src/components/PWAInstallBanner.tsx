import { useState, useEffect } from "react";

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent browser default mini-infobar
      e.preventDefault();
      setDeferredPrompt(e);

      // Check if user dismissed previously
      const dismissed = localStorage.getItem("pwa_install_dismissed");
      if (!dismissed) {
        setShowBanner(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install prompt outcome: ${outcome}`);
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa_install_dismissed", "true");
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-gray-900 text-white p-3.5 rounded-2xl shadow-2xl border border-gray-800 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <img src="/logo.png" alt="SusuBook" className="w-9 h-9 rounded-xl object-contain flex-shrink-0 bg-white p-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white truncate">Install SusuBook</p>
          <p className="text-[11px] text-gray-300 truncate">Add to home screen for offline collection</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={handleInstallClick}
          className="text-xs font-bold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all active:scale-95 shadow-sm shadow-emerald-900"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 text-gray-400 hover:text-white rounded-lg transition-colors"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
