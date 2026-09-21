import { useState, useEffect } from "react";
import SusuLogo from "./SusuLogo";

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // 1. Check if prompt was captured early on page load
    const earlyPrompt = (window as any).deferredPWAInstallPrompt;
    if (earlyPrompt) {
      setDeferredPrompt(earlyPrompt);
      const dismissed = localStorage.getItem("pwa_install_dismissed");
      if (!dismissed) setShowBanner(true);
    }

    // 2. Listen for custom event dispatched by early script in index.html
    const handlePromptReady = () => {
      const promptObj = (window as any).deferredPWAInstallPrompt;
      if (promptObj) {
        setDeferredPrompt(promptObj);
        const dismissed = localStorage.getItem("pwa_install_dismissed");
        if (!dismissed) setShowBanner(true);
      }
    };

    // 3. Fallback direct beforeinstallprompt listener
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).deferredPWAInstallPrompt = e;
      setDeferredPrompt(e);
      const dismissed = localStorage.getItem("pwa_install_dismissed");
      if (!dismissed) setShowBanner(true);
    };

    window.addEventListener("pwa-prompt-ready", handlePromptReady);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("pwa-prompt-ready", handlePromptReady);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    const promptObj = deferredPrompt || (window as any).deferredPWAInstallPrompt;
    if (!promptObj) return;

    promptObj.prompt();
    const { outcome } = await promptObj.userChoice;
    console.log(`[PWA] Install prompt outcome: ${outcome}`);
    (window as any).deferredPWAInstallPrompt = null;
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa_install_dismissed", "true");
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-800 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="bg-white p-1 rounded-xl shadow-xs flex-shrink-0">
          <SusuLogo className="w-8 h-8" size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white truncate">Install SusuBook</p>
          <p className="text-[11px] text-slate-300 truncate">Add to home screen for offline collection</p>
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
          className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
