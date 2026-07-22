const React = window.React;

export function Icon({ name, size = 16, stroke = 1.5 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (name) {
    case 'play': return <svg {...props}><path d="M8 5l11 7-11 7V5z" fill="currentColor" stroke="none"/></svg>;
    case 'clock': return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'list': return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01"/></svg>;
    case 'chart': return <svg {...props}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
    case 'plus': return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'x': return <svg {...props}><path d="M18 6L6 18M6 6l12 12"/></svg>;
    case 'arrow-day': return <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>;
    case 'check': return <svg {...props}><path d="M5 12l4 4L19 6"/></svg>;
    case 'brain': return <svg {...props}><path d="M9 6a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 4 12a2.5 2.5 0 0 0 2 2.45V15a3 3 0 0 0 3 3h.5"/><path d="M15 6a3 3 0 0 1 3 3v.5A2.5 2.5 0 0 1 20 12a2.5 2.5 0 0 1-2 2.45V15a3 3 0 0 1-3 3h-.5"/><path d="M12 6v12"/></svg>;
    case 'bell': return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7zM10 19a2 2 0 0 0 4 0"/></svg>;
    case 'coffee': return <svg {...props}><path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z"/><path d="M16 11h2a2 2 0 0 1 0 4h-2"/><path d="M7 3v3M10 4v2M13 3v3"/></svg>;
    default: return <svg {...props}/>;
  }
}
