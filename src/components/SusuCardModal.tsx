import { useState } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import type { Group, Member } from "../hooks/useSupabaseData";

interface SusuCardModalProps {
  member: Member;
  group: Group;
  collectorName: string;
  onClose: () => void;
}

// Convert image URL to Base64 to ensure html2canvas never hangs on CORS/image fetching
async function imageToBase64(url: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } else {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

// Helper to resolve any oklch color string to standard rgb(...) for html2canvas
function resolveOklchToRgb(colorStr: string): string {
  if (!colorStr || typeof colorStr !== "string" || !colorStr.includes("oklch")) {
    return colorStr;
  }
  try {
    const temp = document.createElement("div");
    temp.style.color = colorStr;
    document.body.appendChild(temp);
    const resolved = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);
    return resolved && !resolved.includes("oklch") ? resolved : "#059669";
  } catch (e) {
    return "#059669";
  }
}

export function SusuCardModal({ member, group, collectorName, onClose }: SusuCardModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const freqLower = group.frequency.toLowerCase();
  const isWeekly = freqLower.includes("weekly") || freqLower.includes("week");
  const isMonthly = freqLower.includes("monthly") || freqLower.includes("month");
  const isDaily = !isWeekly && !isMonthly;

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const weekHeader = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  // Generate slots specifically for the group setup
  let cardSlots: { label: string; amount: number }[] = [];

  if (isMonthly) {
    // 12 Months layout (Jan, Feb, Mar, Apr ...)
    cardSlots = monthNames.map((m) => ({
      label: m,
      amount: group.amount,
    }));
  } else if (isWeekly) {
    // Weekly layout (Wk 1, Wk 2 ... Wk 52 or cycle weeks)
    const totalWeeks = Math.max(12, Math.min(52, (group.cycles || 1) * 4));
    cardSlots = Array.from({ length: totalWeeks }, (_, i) => ({
      label: `Wk ${i + 1}`,
      amount: group.amount,
    }));
  } else {
    // Daily layout (Day 1 through Day 31)
    const totalDays = 31;
    cardSlots = Array.from({ length: totalDays }, (_, i) => ({
      label: `${i + 1}`,
      amount: group.amount,
    }));
  }

  const handleDownloadPDF = async () => {
    const cardEl = document.getElementById("susu-card-content");
    if (!cardEl) {
      alert("Card element not found!");
      return;
    }

    try {
      setIsGenerating(true);

      // Pre-convert images inside card element to Data URLs so html2canvas never hangs
      const images = cardEl.querySelectorAll("img");
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.src && !img.src.startsWith("data:")) {
          try {
            const b64 = await imageToBase64(img.src);
            if (b64 && b64.startsWith("data:")) {
              img.src = b64;
            }
          } catch (e) {
            console.warn("Could not convert image to base64:", e);
          }
        }
      }

      const canvas = await html2canvas(cardEl, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          // 1. Sanitize all <style> blocks in cloned doc to replace oklch(...) with resolved rgb(...)
          const styleElements = clonedDoc.querySelectorAll("style");
          styleElements.forEach((s) => {
            if (s.innerHTML && s.innerHTML.includes("oklch")) {
              s.innerHTML = s.innerHTML.replace(/oklch\([^)]+\)/g, (match) => resolveOklchToRgb(match));
            }
          });

          // 2. Sanitize inline & computed styles on elements inside the card
          const cardContent = clonedDoc.getElementById("susu-card-content");
          if (cardContent) {
            const allEls = [cardContent, ...Array.from(cardContent.querySelectorAll("*"))];
            allEls.forEach((el: any) => {
              if (el.style) {
                ["color", "backgroundColor", "borderColor", "outlineColor"].forEach((prop) => {
                  const val = el.style[prop] || window.getComputedStyle(el)[prop as any];
                  if (val && typeof val === "string" && val.includes("oklch")) {
                    el.style[prop] = resolveOklchToRgb(val);
                  }
                });
              }
            });
          }
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = 210; // A4 width in mm
      const margin = 10; // 10mm margins
      const printWidth = pdfWidth - margin * 2;
      const printHeight = (canvas.height * printWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", margin, margin, printWidth, printHeight);

      const safeName = member.name.replace(/[^a-zA-Z0-9]/g, "_");
      const safeCode = (member.memberCode || member.id.slice(0, 6)).replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `SusuCard_${safeName}_${safeCode}.pdf`;

      // Direct blob download to guarantee execution across desktop and mobile browsers
      const blob = pdf.output("blob");
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err: any) {
      console.error("Failed to generate PDF card:", err);
      alert("Error downloading PDF card: " + (err?.message || "Please try again"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header Control Bar */}
        <div className="bg-gray-900 text-white p-4 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="SusuBook" className="w-7 h-7 object-contain rounded-lg bg-white p-0.5" />
            <div>
              <p className="text-sm font-bold text-white">Physical Susu Card Preview</p>
              <p className="text-[11px] text-gray-400">Clean card formatted for physical ballpoint pen marking</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={isGenerating}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-50 shadow-sm shadow-emerald-900 cursor-pointer"
            >
              <span>{isGenerating ? "⏳" : "📥"}</span>
              <span>{isGenerating ? "Generating..." : "Download PDF"}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-white font-semibold text-xs px-3.5 py-2 rounded-xl transition-all active:scale-95 cursor-pointer"
            >
              <span>🖨️</span>
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all text-sm font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Printable Card View */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-gray-100">
          <div
            id="susu-card-content"
            style={{ backgroundColor: "#ffffff", color: "#111827", borderColor: "#e5e7eb" }}
            className="bg-white p-6 sm:p-8 rounded-xl shadow-lg border border-gray-200 max-w-2xl mx-auto space-y-6 text-gray-900 print:shadow-none print:border-0 print:p-0"
          >
            {/* Top Brand Header */}
            <div
              style={{ borderColor: "#059669" }}
              className="flex items-start justify-between border-b-2 border-emerald-600 pb-4"
            >
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="SusuBook Logo" className="w-14 h-14 object-contain rounded-xl" />
                <div>
                  <h1 style={{ color: "#111827" }} className="text-2xl font-black text-gray-900 tracking-tight">SusuBook</h1>
                  <p style={{ color: "#047857" }} className="text-xs font-semibold text-emerald-700">Your susu properly recorded</p>
                </div>
              </div>
              <div className="text-right">
                <span
                  style={{ backgroundColor: "#d1fae5", color: "#065f46" }}
                  className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 font-mono font-bold text-xs rounded-full uppercase tracking-wider mb-1"
                >
                  OFFICIAL SUSU CARD
                </span>
                <p style={{ color: "#6b7280" }} className="text-[11px] font-mono">ID: <span style={{ color: "#111827" }} className="font-bold">{member.memberCode || member.id.slice(0, 8)}</span></p>
              </div>
            </div>

            {/* Member & Group Profile Box */}
            <div
              style={{ backgroundColor: "#ecfdf5", borderColor: "#d1fae5" }}
              className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-emerald-100 text-xs"
            >
              <div className="space-y-1.5">
                <p><span style={{ color: "#6b7280" }} className="font-medium">Member Name:</span> <strong style={{ color: "#111827" }} className="text-sm block">{member.name}</strong></p>
                <p><span style={{ color: "#6b7280" }} className="font-medium">Phone:</span> <strong style={{ color: "#1f2937" }}>{member.phone}</strong></p>
                <p><span style={{ color: "#6b7280" }} className="font-medium">Address / Community:</span> <strong style={{ color: "#1f2937" }}>{member.address || "N/A"}</strong></p>
              </div>
              <div className="space-y-1.5">
                <p><span style={{ color: "#6b7280" }} className="font-medium">Savings Group:</span> <strong style={{ color: "#064e3b" }} className="text-sm block">{group.name}</strong></p>
                <p><span style={{ color: "#6b7280" }} className="font-medium">Rate / Frequency:</span> <strong style={{ color: "#1f2937" }}>{group.currency} {group.amount.toLocaleString()} / {group.frequency}</strong></p>
                <p><span style={{ color: "#6b7280" }} className="font-medium">Collector Name:</span> <strong style={{ color: "#1f2937" }}>{collectorName}</strong></p>
              </div>
            </div>

            {/* Physical Contribution Roster Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 style={{ color: "#1f2937" }} className="text-xs font-bold uppercase tracking-wider">
                  {group.frequency} Contribution Roster ({isMonthly ? "12 Months" : isWeekly ? `${cardSlots.length} Weeks` : "31 Days"})
                </h2>
                <span style={{ color: "#6b7280" }} className="text-[11px] font-medium italic">
                  * Collector physically marks square box upon cash payment
                </span>
              </div>

              {/* 7-Column Days Header Bar for Daily Setup */}
              {isDaily && (
                <div
                  style={{ backgroundColor: "#f3f4f6", borderColor: "#e5e7eb", color: "#6b7280" }}
                  className="grid grid-cols-7 gap-1.5 text-center font-mono font-bold text-[10px] py-1.5 rounded-lg border"
                >
                  {weekHeader.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
              )}

              {/* Grid of Clean, Plain & Smaller Square Boxes for Pen Marking */}
              <div
                className={`grid ${
                  isMonthly
                    ? "grid-cols-4 sm:grid-cols-6"
                    : isWeekly
                    ? "grid-cols-6 sm:grid-cols-8"
                    : "grid-cols-7"
                } gap-1.5 sm:gap-2`}
              >
                {cardSlots.map((s, idx) => (
                  <div
                    key={idx}
                    style={{ backgroundColor: "#ffffff", borderColor: "#9ca3af", color: "#111827" }}
                    className="aspect-square border rounded-md p-1 flex flex-col justify-between shadow-2xs"
                  >
                    {/* Top Row: Label & Amount */}
                    <div className="flex items-center justify-between w-full leading-none">
                      <span style={{ color: "#111827" }} className="font-mono font-bold text-[10px]">
                        {s.label}
                      </span>
                      <span style={{ color: "#6b7280" }} className="text-[8px] font-mono font-medium">
                        {group.currency}{s.amount}
                      </span>
                    </div>

                    {/* Completely Plain Center Space for Pen Cross-Off */}
                    <div className="flex-1 w-full"></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Instructions & Signature Line */}
            <div
              style={{ borderColor: "#e5e7eb" }}
              className="pt-4 border-t-2 flex items-end justify-between gap-4 text-xs"
            >
              <div style={{ color: "#4b5563" }} className="space-y-1 max-w-sm text-[11px]">
                <p style={{ color: "#1f2937" }} className="font-bold">Instructions for Collector:</p>
                <p>1. Upon receiving payment, draw an <strong>"✕" cross mark</strong> inside the corresponding square box with a ballpoint pen.</p>
                <p>2. Keep this physical card safe — it serves as the member's official receipt card.</p>
              </div>

              <div className="text-center space-y-1.5 min-w-[160px]">
                <div style={{ borderColor: "#9ca3af" }} className="border-b-2 h-10"></div>
                <p style={{ color: "#374151" }} className="text-[10px] font-bold uppercase tracking-wider">Collector Signature</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
