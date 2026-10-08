const ALERT_ICON_PATHS = {
  away: <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />,
  notStarted: <><path d="M7 3.5h6.5L18 8v12.5H7z" /><path d="M13.5 3.5V8H18" /></>,
  noTyping: <path d="M9.5 6.5v11M14.5 6.5v11" />,
  pasted: <><rect x="6" y="4.5" width="12" height="16" rx="2" /><path d="M9.5 3.5h5v3h-5z" /></>,
  messages: <path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5H4.5z" />,
};

export default function AlertIcon({ id }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ALERT_ICON_PATHS[id]}
    </svg>
  );
}
