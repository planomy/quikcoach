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
 * Shared “Not confident” colour — gold-amber between neon yellow and orange,
 * clearly distinct from red “Guessed”.
 */
export const UNSURE_COLOR = '#f0a818';

/** Text summary used by participant-card tooltips and focused detail. */
export function studentTileMeta(student) {
  if (student.promptExcluded) {
    return {
      title: student.connected ? 'Their question · not asked to answer' : 'Offline · their question',
    };
  }
  if (student.engagement_status && student.engagement_status !== 'ready') {
    return {
      title: student.connected
        ? (LIVE_STATUS_LABELS[student.engagement_status] || student.engagement_status)
        : `Offline · ${LIVE_STATUS_LABELS[student.engagement_status] || student.engagement_status}`,
    };
  }
  if (student.hasResponded) {
    const confidence = student.response?.confidence || '';
    if (confidence === 'confident') {
      return { title: student.connected ? 'Answered · confident' : 'Offline · answered · confident' };
    }
    if (confidence === 'unsure') {
      return { title: student.connected ? 'Answered · not confident' : 'Offline · answered · not confident' };
    }
    if (confidence === 'guessed') {
      return { title: student.connected ? 'Answered · guessed' : 'Offline · answered · guessed' };
    }
    return { title: student.connected ? 'Answered' : 'Offline · answered' };
  }
  return {
    title: student.connected ? 'Waiting' : 'Offline',
  };
}
