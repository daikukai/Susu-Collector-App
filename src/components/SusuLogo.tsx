import { useState } from "react";

interface SusuLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export default function SusuLogo({ className = "w-20 h-20", size = "md" }: SusuLogoProps) {
  const [imgSrc, setImgSrc] = useState("/logo.png");
  const [failed, setFailed] = useState(false);

  const handleError = () => {
    if (imgSrc === "/logo.png") {
      setImgSrc("/susubook-logo.png");
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div
        className={`${className} bg-gradient-to-br from-emerald-600 to-teal-800 rounded-2xl shadow-lg flex items-center justify-center border border-emerald-400/30 p-1 flex-shrink-0`}
      >
        <span className={size === "sm" ? "text-xs" : size === "lg" ? "text-3xl" : "text-xl"}>💰</span>
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt="SusuBook Logo"
      onError={handleError}
      className={`${className} object-contain rounded-2xl flex-shrink-0`}
    />
  );
}
