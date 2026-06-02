// Modern SVG icon components
// All icons: 16x16 default, stroke-based, currentColor

interface IconProps {
  size?: number;
  className?: string;
}

const S = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

// Navigation
export function BackIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}
export function ArrowRight({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
}
export function ArrowLeft({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}
export function ChevronDown({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}><path d="M6 9l6 6 6-6" /></svg>;
}

// Actions
export function SaveIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>;
}
export function UndoIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 105.64-11.36L1 10" />
  </svg>;
}
export function RedoIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 11-5.64-11.36L23 10" />
  </svg>;
}
export function RefreshIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
  </svg>;
}

// File/Folder
export function FolderIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>;
}
export function FolderOpenIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v1" />
    <path d="M2 10l2.586 2.586a2 2 0 001.414.586H22" />
  </svg>;
}
export function FileIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>;
}
export function FileExcelIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h2M8 17h2M14 13h2M14 17h2" />
  </svg>;
}

// Status indicators
export function CheckIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}><polyline points="20 6 9 17 4 12" /></svg>;
}
export function XIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>;
}
export function AlertIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>;
}
export function InfoIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>;
}

// Merge operations
export function CopyRightIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    <path d="M15 12l-3-3 3-3" transform="translate(1, 3)" />
  </svg>;
}
export function CopyLeftIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    <path d="M9 12l3-3-3-3" transform="translate(-1, 3)" />
  </svg>;
}
export function PlusIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>;
}
export function SwapIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" />
  </svg>;
}

// Filter
export function FilterIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>;
}
export function KeyIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>;
}

// Settings
export function SettingsIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>;
}

// Misc
export function SearchIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>;
}
export function MenuIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>;
}
export function DiffIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <rect x="3" y="3" width="7" height="18" rx="1" />
    <rect x="14" y="3" width="7" height="18" rx="1" />
    <line x1="10" y1="8" x2="14" y2="8" className="text-red-500" />
    <line x1="10" y1="12" x2="14" y2="12" className="text-green-500" />
    <line x1="10" y1="16" x2="14" y2="16" className="text-blue-500" />
  </svg>;
}
export function SaveAllIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>;
}
export function PlayIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
  </svg>;
}

// Loading spinner
export function SpinnerIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={`animate-spin ${className || ''}`}>
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </svg>;
}

// Clock
export function ClockIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>;
}

// Edit
export function EditIcon({ size = 16, className }: IconProps) {
  return <svg {...S(size)} className={className}>
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>;
}
