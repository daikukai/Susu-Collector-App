import React from "react";
import officialLogo from "../assets/susubook_official_logo.png";

interface SusuLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export default function SusuLogo({ className = "w-20 h-20" }: SusuLogoProps) {
  return (
    <img
      src={officialLogo}
      alt="SusuBook Official Logo"
      className={`${className} object-contain rounded-2xl flex-shrink-0`}
    />
  );
}
