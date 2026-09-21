import { OFFICIAL_SUSUBOOK_LOGO } from "../assets/logoData";

interface SusuLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export default function SusuLogo({ className = "w-20 h-20" }: SusuLogoProps) {
  return (
    <img
      src={OFFICIAL_SUSUBOOK_LOGO}
      alt="SusuBook Official Logo"
      className={`${className} object-contain rounded-2xl flex-shrink-0`}
    />
  );
}
