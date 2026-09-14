interface DawnLogoProps {
  className?: string;
  title?: string;
}

export function DawnLogo({ className, title }: DawnLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
    >
      <circle cx="32" cy="27" r="8" fill="#f2a93b" />
      <path fill="#6d4bd2" d="M7 27.5c9.9-2.3 18.2.25 25 7.6V56c-7.15-5.35-15.5-7.45-25-6.2V27.5Z" />
      <path fill="#6d4bd2" d="M57 26.5c-9.65-1.65-18 1.2-25 8.6V56c7.4-5.15 15.75-7.25 25-6.3V26.5Z" />
      <path d="M32 35.5v19" stroke="#fbfafc" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
