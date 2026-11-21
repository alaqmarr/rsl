import React from "react";

export interface BrandIconProps {
  className?: string;
}

export function WhatsAppBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12.04 2a9.93 9.93 0 0 0-8.49 15.11L2 22l5.05-1.32A9.94 9.94 0 1 0 12.04 2Zm0 18.14a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3 .78.8-2.92-.2-.3a8.2 8.2 0 1 1 6.88 3.76Zm4.5-6.15c-.25-.12-1.46-.72-1.69-.8s-.39-.12-.56.12-.64.8-.79.96-.29.18-.54.06a6.73 6.73 0 0 1-1.98-1.22 7.45 7.45 0 0 1-1.37-1.71c-.14-.25 0-.38.11-.5s.25-.29.37-.43a1.65 1.65 0 0 0 .25-.41.45.45 0 0 0-.02-.43c-.06-.12-.56-1.34-.77-1.84s-.41-.42-.56-.43h-.47a.92.92 0 0 0-.66.31 2.77 2.77 0 0 0-.86 2.06 4.82 4.82 0 0 0 1.01 2.55 11.03 11.03 0 0 0 4.22 3.73 14.3 14.3 0 0 0 1.41.52 3.39 3.39 0 0 0 1.56.1 2.55 2.55 0 0 0 1.67-1.18 2.06 2.06 0 0 0 .14-1.18c-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

export function FacebookBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.78-3.91 1.09 0 2.24.2 2.24.2v2.47H15.2c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.76 8.43-4.92 8.43-9.94Z" />
    </svg>
  );
}

export function MessengerBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12 2C6.37 2 2 6.13 2 11.7c0 2.91 1.2 5.42 3.15 7.16.16.14.26.35.27.58l.05 1.81a.82.82 0 0 0 1.15.72l2.02-.89a.82.82 0 0 1 .55-.04c.88.24 1.83.37 2.81.37 5.63 0 10-4.13 10-9.7S17.63 2 12 2Zm5.98 7.57-2.94 4.67a1.5 1.5 0 0 1-2.16.4l-2.34-1.76a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.19-.69-.64l2.94-4.67a1.5 1.5 0 0 1 2.16-.4l2.34 1.76a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.19.69.64Z" />
    </svg>
  );
}

export function InstagramBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MetaBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M16.76 5.5c-1.84 0-3.25 1.12-4.76 3.05-1.51-1.93-2.92-3.05-4.76-3.05C4.27 5.5 2 8.2 2 12.1c0 3.55 1.98 5.9 4.74 5.9 1.66 0 2.98-.88 4.44-2.83l.82-1.11.82 1.11c1.46 1.95 2.78 2.83 4.44 2.83 2.76 0 4.74-2.35 4.74-5.9 0-3.9-2.27-6.6-5.24-6.6Zm-9.9 10.35c-1.45 0-2.66-1.46-2.66-3.75 0-2.55 1.24-4.4 2.94-4.4 1.17 0 2.13.78 3.4 2.55l.36.52-.42.58c-1.35 1.88-2.36 4.5-3.62 4.5Zm10.28 0c-1.26 0-2.27-2.62-3.62-4.5l-.42-.58.36-.52c1.27-1.77 2.23-2.55 3.4-2.55 1.7 0 2.94 1.85 2.94 4.4 0 2.29-1.21 3.75-2.66 3.75Z" />
    </svg>
  );
}

export function GoogleBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M21.8 12.23c0-.72-.06-1.41-.18-2.08H12v3.94h5.5a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.04-4.4 3.04-7.5Z" />
      <path d="M12 22c2.75 0 5.06-.91 6.75-2.47l-3.3-2.56c-.91.61-2.08.97-3.45.97-2.65 0-4.9-1.79-5.7-4.2H2.89v2.64A10 10 0 0 0 12 22Z" />
      <path d="M6.3 13.74A6.01 6.01 0 0 1 5.99 12c0-.61.11-1.19.31-1.74V7.62H2.89A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49l3.23-2.75Z" />
      <path d="M12 6.06c1.5 0 2.84.51 3.9 1.53l2.92-2.92C17.05 3.02 14.74 2 12 2A10 10 0 0 0 2.89 7.62l3.41 2.64c.8-2.41 3.05-4.2 5.7-4.2Z" />
    </svg>
  );
}

export function GoogleBusinessBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 9.5 4.8 4h14.4L21 9.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 9.5Z" />
      <path d="M5 12v8h14v-8" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

export function GoogleAdsBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M13.66 4.02a2.6 2.6 0 0 0-3.55.95L3.36 16.65a2.6 2.6 0 0 0 .95 3.55 2.6 2.6 0 0 0 3.55-.95L14.61 7.57a2.6 2.6 0 0 0-.95-3.55Z" />
      <path d="M20.64 16.65 16.39 9.29l-2.6 4.5 2.35 4.06a2.6 2.6 0 0 0 4.5-2.6Z" opacity="0.72" />
      <circle cx="5.6" cy="18.2" r="2.6" />
    </svg>
  );
}

export function GoogleDriveBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M8.8 3.5h6.4l6.2 10.7H15L8.8 3.5Z" />
      <path d="M7.6 5.5 2 15.2l3.2 5.3 5.6-9.7-3.2-5.3Z" opacity="0.8" />
      <path d="M6.4 20.5h12.4l3.2-5.3H9.6l-3.2 5.3Z" opacity="0.65" />
    </svg>
  );
}

export function GoogleSheetsBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8L14 2.5Z" />
      <path d="M14 2.5V8h5.5" />
      <rect x="7.5" y="11" width="9" height="7" rx="1" />
      <path d="M7.5 14.5h9M12 11v7" />
    </svg>
  );
}

export function GoogleSearchConsoleBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m20.5 20.5-4.35-4.35" />
      <path d="M8 12v-2.5M10.5 12V8.5M13 12v-1.5" />
    </svg>
  );
}

export function CloudflareBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M17.34 17.25H5.75a3.75 3.75 0 0 1-.42-7.47 5.5 5.5 0 0 1 10.67-1.15 4.25 4.25 0 0 1 3.74 4.22c0 .15-.01.3-.03.45a3.25 3.25 0 0 1-2.37 3.95Z" />
    </svg>
  );
}

export function TallyBrandIcon({ className = "h-4 w-4 shrink-0" }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3.5" y="3" width="17" height="18" rx="3" />
      <path d="M7.5 8h9M12 8v9M8 13.5h8" />
    </svg>
  );
}
