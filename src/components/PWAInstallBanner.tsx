import { useState, useEffect } from "react";
import SusuLogo from "./SusuLogo";

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Check if app is already running in installed standalone mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes("android-app://");

    if (isStandalone) {
      setShowBanner(false);
      return;
    }

    // Detect iOS devices
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iosDevice);

    const dismissed = localStorage.getItem("pwa_install_dismissed");

    if (iosDevice) {
      if (!dismissed) setShowBanner(true);
      return;
    }

    // Check early captured prompt
    const earlyPrompt = (window as any).deferredPWAInstallPrompt;
    if (earlyPrompt) {
      setDeferredPrompt(earlyPrompt);
      if (!dismissed) setShowBanner(true);
    }

    const handlePromptReady = () => {
      const promptObj = (window as any).deferredPWAInstallPrompt;
      if (promptObj) {
        setDeferredPrompt(promptObj);
        if (!dismissed) setShowBanner(true);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).deferredPWAInstallPrompt = e;
      setDeferredPrompt(e);
      if (!dismissed) setShowBanner(true);
    };

    window.addEventListener("pwa-prompt-ready", handlePromptReady);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Smart fallback for mobile browsers where beforeinstallprompt delay occurs
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    if (isMobile && !dismissed) {
      setShowBanner(true);
    }

    return () => {
      window.removeEventListener("pwa-prompt-ready", handlePromptReady);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    const promptObj = deferredPrompt || (window as any).deferredPWAInstallPrompt;
    if (promptObj) {
      try {
        promptObj.prompt();
        const { outcome } = await promptObj.userChoice;
        console.log(`[PWA] Install prompt outcome: ${outcome}`);
        (window as any).deferredPWAInstallPrompt = null;
        setDeferredPrompt(null);
        setShowBanner(false);
      } catch (err) {
        console.warn("[PWA] Prompt error:", err);
        setShowInstructions(true);
      }
    } else {
      setShowInstructions(true);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa_install_dismissed", "true");
  };

  if (!showBanner) return null;

  return (
    <>
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-800 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="bg-white p-1 rounded-xl shadow-xs flex-shrink-0">
            <SusuLogo className="w-8 h-8" size="sm" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate">Install SusuBook App</p>
            <p className="text-[11px] text-slate-300 truncate">
              {isIOS ? "Tap Share ➔ Add to Home Screen" : "Add to home screen for offline collection"}
            </p>
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

      {showInstructions && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <SusuLogo className="w-6 h-6" size="sm" />
                <p className="text-sm font-bold">How to Install SusuBook</p>
              </div>
              <button onClick={() => setShowInstructions(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            {isIOS ? (
              <div className="space-y-2 text-xs text-slate-300">
                <p className="font-semibold text-emerald-400">On iPhone / iPad (Safari):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-200">
                  <li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                  <li>Tap <strong>Add</strong> in the top right corner.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2 text-xs text-slate-300">
                <p className="font-semibold text-emerald-400">On Android / Chrome:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-200">
                  <li>Tap the <strong>Menu (⋮)</strong> icon in top right of Chrome.</li>
                  <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
                  <li>Follow the on-screen prompt to install.</li>
                </ol>
              </div>
            )}

            <button
              onClick={() => setShowInstructions(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
