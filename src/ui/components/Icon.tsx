/** Line icons drawn for this app (24×24, 2px stroke, currentColor). */
const PATHS: Record<string, string> = {
  crm: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  sales: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  projects: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z',
  installation: 'M3 15 6 6h12l3 9zM4.5 10.5h15M9 6l-1 9M15 6l1 9M12 15v5M8 20h8',
  inventory: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  purchase: 'M2 6h11v9H2zM13 9h4l4 4v2h-8zM6 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  finance: 'M7 4h10M7 8h10M7 4c4 0 6 1.5 6 4s-2 4-6 4h-.5L14 20',
  subsidy: 'M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M12 3 3 8h18z',
  loans: 'M4 6h16v12H4zM4 10h16M8 15h3',
  service: 'M4 13a8 8 0 0 1 16 0M4 13v4a2 2 0 0 0 2 2h1v-6H4M20 13v4a2 2 0 0 1-2 2h-1v-6h3',
  documents: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  staff: 'M5 4h14v16H5zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M8.5 16a3.5 3.5 0 0 1 7 0',
  dashboard: 'M3.5 17a8.5 8.5 0 1 1 17 0M12 17l4.2-5.2M12 17m-1.6 0a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M6.3 11.3l1.3.9M12 8.5V10M17.7 11.3l-1.3.9M3.5 20h17',
  filter: 'M3 5h18l-7 8.5V19l-4 2v-7.5z',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
  alerts: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  home: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-4.3-4.3',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  board: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  pivot: 'M3 3h18v18H3zM3 9h18M9 3v18',
  graph: 'M4 20V11M10 20V6M16 20v-5M22 20H2',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

export const ICON_NAMES = Object.keys(PATHS);

export function Icon({ name, size = 20, className, label }: { name: string; size?: number; className?: string; label?: string }) {
  const d = PATHS[name] || PATHS.dashboard;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} />
    </svg>
  );
}
