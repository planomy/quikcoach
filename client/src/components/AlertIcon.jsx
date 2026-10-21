import GaugeIcon from './GaugeIcon.jsx';

const ALERT_ICON_IDS = {
  away: 'away',
  notStarted: 'not-started',
  noTyping: 'no-typing',
  pasted: 'pasted',
  messages: 'inbox',
};

export default function AlertIcon({ id }) {
  return <GaugeIcon id={ALERT_ICON_IDS[id]} />;
}
