export const LIVE_STATUS_LABELS = {
  ready: 'Ready',
  unsure: 'Unsure',
  tech: 'Tech issue',
  stuck: 'I’m stuck',
  slow: 'Please slow down',
  explain: 'Explain again',
  private: 'Needs private help',
};

/**
 * Shared “Not sure” colour — gold-amber between neon yellow and orange,
 * clearly distinct from red “Guessed”.
 */
export const UNSURE_COLOR = '#f0a818';
export const UNSURE_BORDER_CLASS = 'border-2 border-[#f0a818]';
export const UNSURE_TEXT_CLASS = 'text-[#f0a818] dark:text-[#fbbf24]';

/** Border colour encodes answer / engagement state for participant cards. */
export function studentTileMeta(student) {
  if (student.engagement_status && student.engagement_status !== 'ready') {
    return {
      title: student.connected
        ? (LIVE_STATUS_LABELS[student.engagement_status] || student.engagement_status)
        : `Offline · ${LIVE_STATUS_LABELS[student.engagement_status] || student.engagement_status}`,
      className: 'border-2 border-amber-400',
    };
  }
  if (student.hasResponded) {
    const confidence = student.response?.confidence || '';
    if (confidence === 'confident') {
      return { title: student.connected ? 'Answered · confident' : 'Offline · answered · confident', className: 'border-2 border-emerald-500' };
    }
    if (confidence === 'unsure') {
      return { title: student.connected ? 'Answered · not sure' : 'Offline · answered · not sure', className: UNSURE_BORDER_CLASS };
    }
    if (confidence === 'guessed') {
      return { title: student.connected ? 'Answered · guessed' : 'Offline · answered · guessed', className: 'border-2 border-red-500' };
    }
    return { title: student.connected ? 'Answered' : 'Offline · answered', className: 'border-2 border-indigo-400' };
  }
  return {
    title: student.connected ? 'Waiting' : 'Offline',
    className: 'border-2 border-slate-200 dark:border-slate-700',
  };
}
