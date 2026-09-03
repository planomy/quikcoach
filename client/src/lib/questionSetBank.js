/** Launch library of teaching question sets. Bank sets are not deletable. */

function q(prompts) {
  return prompts.map((prompt, index) => ({
    id: `p${index + 1}`,
    type: 'short',
    prompt,
    options: [],
    correctAnswer: '',
  }));
}

function set(def) {
  return {
    ...def,
    bank: true,
    questions: q(def.prompts),
  };
}

export const SUBJECTS = ['English', 'HASS', 'Maths', 'Science', 'General'];
export const YEAR_BANDS = ['5–6', '7–8', '9–10', '11–12'];

export const QUESTION_SET_BANK = [
  // English — 12
  set({
    id: 'bank-eng-01',
    name: 'Build a Narrative Paragraph',
    subject: 'English',
    years: '5–6',
    skill: 'Writing',
    minutes: 10,
    prompts: [
      'Where is your character?',
      'What is happening right now?',
      'Add one detail we can see, hear or feel.',
      'What does your character do next?',
      'Reread. What could you improve?',
    ],
  }),
  set({
    id: 'bank-eng-02',
    name: 'Bring a Scene to Life',
    subject: 'English',
    years: '7–8',
    skill: 'Writing',
    minutes: 10,
    prompts: [
      'What does your character want in this moment?',
      'Choose one important action.',
      'Add a sensory detail.',
      'Show how the character feels without simply naming the feeling.',
      'Which sentence could you make more vivid?',
    ],
  }),
  set({
    id: 'bank-eng-03',
    name: 'Craft a Powerful Scene',
    subject: 'English',
    years: '9–10',
    skill: 'Writing',
    minutes: 12,
    prompts: [
      'What tension or idea should this scene develop?',
      'What should the reader notice first?',
      'Use action, description or dialogue to reveal character.',
      'Choose one detail with symbolic or emotional significance.',
      'Revise one sentence for greater impact.',
    ],
  }),
  set({
    id: 'bank-eng-04',
    name: 'Analytical Paragraph Builder',
    subject: 'English',
    years: '7–8',
    skill: 'Writing',
    minutes: 12,
    prompts: [
      'What is your main point about the text?',
      'Choose evidence that supports it.',
      'What important word or technique can you zoom in on?',
      'What does this show the reader?',
      'How does it connect back to your point?',
    ],
  }),
  set({
    id: 'bank-eng-05',
    name: 'Develop an Analytical Paragraph',
    subject: 'English',
    years: '9–10',
    skill: 'Writing',
    minutes: 15,
    prompts: [
      'What argument will this paragraph make?',
      'Select the strongest evidence.',
      'Identify a significant word, technique or structural choice.',
      'Explain how it shapes meaning.',
      'What does the author want the audience to understand?',
      'Link this back to your argument.',
    ],
  }),
  set({
    id: 'bank-eng-06',
    name: 'Senior Analytical Paragraph',
    subject: 'English',
    years: '11–12',
    skill: 'Writing',
    minutes: 15,
    prompts: [
      'What interpretation are you advancing?',
      'Which textual evidence best supports it?',
      'Analyse a deliberate language, structural or stylistic choice.',
      'How does this choice position the audience?',
      'How does context, perspective or purpose deepen the meaning?',
      'Connect your analysis to the broader argument.',
    ],
  }),
  set({
    id: 'bank-eng-07',
    name: 'Character Analysis',
    subject: 'English',
    years: '7–8',
    skill: 'Reading',
    minutes: 10,
    prompts: [
      'What do we learn about this character?',
      'Find one moment that reveals this.',
      'What does the character say, do or think?',
      'What does this suggest about them?',
      'Does your view of the character change?',
    ],
  }),
  set({
    id: 'bank-eng-08',
    name: 'Theme Analysis',
    subject: 'English',
    years: '9–10',
    skill: 'Reading',
    minutes: 12,
    prompts: [
      'What idea about life or society is the text exploring?',
      'Where can you see this idea in the text?',
      'What technique helps communicate it?',
      'How does the idea develop or change?',
      'What might the author want us to consider?',
    ],
  }),
  set({
    id: 'bank-eng-09',
    name: 'Poetry Close Reading',
    subject: 'English',
    years: '7–10',
    skill: 'Reading',
    minutes: 10,
    prompts: [
      'What is happening in the poem?',
      'Which word or image stands out?',
      'What technique is being used?',
      'What feeling or idea does it create?',
      'Why might the poet have chosen it?',
    ],
  }),
  set({
    id: 'bank-eng-10',
    name: 'Build a Persuasive Paragraph',
    subject: 'English',
    years: '7–10',
    skill: 'Writing',
    minutes: 10,
    prompts: [
      'What do you want your audience to believe?',
      'Give your strongest reason.',
      'Add evidence or an example.',
      'Choose persuasive language deliberately.',
      'Explain why your point matters.',
    ],
  }),
  set({
    id: 'bank-eng-11',
    name: 'Improve Your Draft',
    subject: 'English',
    years: '7–10',
    skill: 'Writing',
    minutes: 10,
    prompts: [
      'Highlight the sentence you are happiest with.',
      'Find one sentence that is unclear or awkward.',
      'Where could you use a more precise word?',
      'Have you repeated an idea?',
      'Make one change that improves the whole piece.',
    ],
  }),
  set({
    id: 'bank-eng-12',
    name: 'Plan a Senior Essay',
    subject: 'English',
    years: '11–12',
    skill: 'Planning',
    minutes: 12,
    prompts: [
      'What is your overall interpretation or contention?',
      'What will each body paragraph argue?',
      'What evidence could support each argument?',
      'Where are the strongest links between ideas?',
      'What complexity or alternative interpretation should you address?',
    ],
  }),

  // HASS — 8
  set({
    id: 'bank-hass-13',
    name: 'Source Detective',
    subject: 'HASS',
    years: '5–6',
    skill: 'Sources',
    minutes: 10,
    prompts: [
      'Who made this source?',
      'When was it made?',
      'What does it show or tell us?',
      'Why might it have been created?',
      'What question could this source help us answer?',
    ],
  }),
  set({
    id: 'bank-hass-14',
    name: 'IOPCAM Source Analysis',
    subject: 'HASS',
    years: '7–8',
    skill: 'Sources',
    minutes: 12,
    prompts: [
      'I: What information does the source contain?',
      'O: Who created it and when?',
      'P: Why was it created?',
      'C: What was happening at the time?',
      'A: Who was it made for?',
      'M: What message is it communicating?',
    ],
  }),
  set({
    id: 'bank-hass-15',
    name: 'Reliability & Usefulness',
    subject: 'HASS',
    years: '9–10',
    skill: 'Sources',
    minutes: 12,
    prompts: [
      'What claim or message does the source present?',
      'Who created it and for what purpose?',
      "What might influence the creator's perspective?",
      'What makes this source useful?',
      'What are its limitations?',
      'What other evidence would you want?',
    ],
  }),
  set({
    id: 'bank-hass-16',
    name: 'Senior Source Evaluation',
    subject: 'HASS',
    years: '11–12',
    skill: 'Sources',
    minutes: 12,
    prompts: [
      'What perspective does the source construct?',
      'How do origin, context and purpose shape that perspective?',
      'What evidence within the source is particularly significant?',
      'What limitations affect its usefulness?',
      'How could it be corroborated?',
    ],
  }),
  set({
    id: 'bank-hass-17',
    name: 'Cause & Consequence',
    subject: 'HASS',
    years: '7–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'What happened?',
      'What were the main causes?',
      'Which cause was most important and why?',
      'What were the immediate consequences?',
      'What changed in the longer term?',
    ],
  }),
  set({
    id: 'bank-hass-18',
    name: 'Continuity & Change',
    subject: 'HASS',
    years: '7–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'What changed during this period?',
      'What stayed the same?',
      'Who experienced the greatest change?',
      'What caused the change?',
      'Was the change sudden or gradual?',
    ],
  }),
  set({
    id: 'bank-hass-19',
    name: 'Different Perspectives',
    subject: 'HASS',
    years: '7–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'Who are the different people or groups involved?',
      'What does each group want or believe?',
      'Why might their views differ?',
      'Whose perspective is missing?',
      'How does perspective change our understanding?',
    ],
  }),
  set({
    id: 'bank-hass-20',
    name: 'Read a Geography Source',
    subject: 'HASS',
    years: '7–10',
    skill: 'Sources',
    minutes: 10,
    prompts: [
      'What does the map, graph or data show?',
      'What pattern can you identify?',
      'What is unusual?',
      'What might explain the pattern?',
      'What conclusion can you reasonably make?',
    ],
  }),

  // Maths — 8
  set({
    id: 'bank-maths-21',
    name: 'Understand the Problem',
    subject: 'Maths',
    years: '5–6',
    skill: 'Problem-solving',
    minutes: 8,
    prompts: [
      'What is the problem asking you to find?',
      'What information do you know?',
      'Is there any information you do not need?',
      'What operation or strategy might help?',
      'Estimate the answer before solving.',
    ],
  }),
  set({
    id: 'bank-maths-22',
    name: 'Problem-Solving Routine',
    subject: 'Maths',
    years: '7–8',
    skill: 'Problem-solving',
    minutes: 12,
    prompts: [
      'What is the unknown?',
      'Write down the useful information.',
      'Choose a strategy.',
      'Show your working clearly.',
      'Check whether your answer makes sense.',
      'Explain your answer in one sentence.',
    ],
  }),
  set({
    id: 'bank-maths-23',
    name: 'Plan a Multi-Step Problem',
    subject: 'Maths',
    years: '9–10',
    skill: 'Problem-solving',
    minutes: 15,
    prompts: [
      'What quantities are involved?',
      'What relationships can you identify?',
      'Which mathematical idea or formula applies?',
      'Break the problem into steps.',
      'Solve and justify your method.',
      'Check your result.',
    ],
  }),
  set({
    id: 'bank-maths-24',
    name: 'Does My Answer Make Sense?',
    subject: 'Maths',
    years: '5–8',
    skill: 'Problem-solving',
    minutes: 8,
    prompts: [
      'Estimate first.',
      'Solve the problem.',
      'Compare your answer with your estimate.',
      'Check your units.',
      'What could you do to verify your answer another way?',
    ],
  }),
  set({
    id: 'bank-maths-25',
    name: 'Find the Error',
    subject: 'Maths',
    years: '7–10',
    skill: 'Problem-solving',
    minutes: 10,
    note: 'Works best with a worked example on the board.',
    prompts: [
      'Study the working carefully.',
      'Where does the first error occur?',
      'What do you think the student was trying to do?',
      'Explain why the step is incorrect.',
      'Show what should happen next.',
    ],
  }),
  set({
    id: 'bank-maths-26',
    name: 'Explain Your Method',
    subject: 'Maths',
    years: '7–10',
    skill: 'Problem-solving',
    minutes: 10,
    prompts: [
      'What strategy did you use?',
      'Why did you choose it?',
      'Show the important steps.',
      'Which step required the most thinking?',
      'Explain your solution so another student could follow it.',
    ],
  }),
  set({
    id: 'bank-maths-27',
    name: 'Compare Two Strategies',
    subject: 'Maths',
    years: '7–10',
    skill: 'Problem-solving',
    minutes: 10,
    prompts: [
      'How does Strategy A work?',
      'How does Strategy B work?',
      'What do they have in common?',
      'Which is more efficient here?',
      'When might the other strategy be better?',
    ],
  }),
  set({
    id: 'bank-maths-28',
    name: 'Read the Data',
    subject: 'Maths',
    years: '7–10',
    skill: 'Problem-solving',
    minutes: 10,
    prompts: [
      'What does the graph/table represent?',
      'What pattern can you see?',
      'What is the highest or lowest value?',
      'What comparison can you make?',
      'What conclusion is supported by the data?',
    ],
  }),

  // Science — 8
  set({
    id: 'bank-sci-29',
    name: 'Predict–Observe–Explain',
    subject: 'Science',
    years: '5–8',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'What do you predict will happen?',
      'Why do you think that?',
      'What actually happened?',
      'Was your prediction correct?',
      'How can you explain the result?',
    ],
  }),
  set({
    id: 'bank-sci-30',
    name: 'Identify the Variables',
    subject: 'Science',
    years: '7–8',
    skill: 'Inquiry',
    minutes: 8,
    prompts: [
      'What are you changing?',
      'What are you measuring?',
      'What needs to stay the same?',
      'Why is a fair test important?',
    ],
  }),
  set({
    id: 'bank-sci-31',
    name: 'Plan an Investigation',
    subject: 'Science',
    years: '7–8',
    skill: 'Inquiry',
    minutes: 12,
    prompts: [
      'What question are you investigating?',
      'What is your hypothesis?',
      'What will you change and measure?',
      'What equipment do you need?',
      'How will you make the test fair?',
      'What data will you collect?',
    ],
  }),
  set({
    id: 'bank-sci-32',
    name: 'Claim–Evidence–Reasoning',
    subject: 'Science',
    years: '9–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'What claim can you make?',
      'Which evidence supports it?',
      'What scientific idea helps explain the evidence?',
      'Explain clearly how the evidence supports your claim.',
    ],
  }),
  set({
    id: 'bank-sci-33',
    name: 'Interpret Scientific Data',
    subject: 'Science',
    years: '7–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'What trend or pattern can you identify?',
      'What evidence supports that observation?',
      'Are there any unusual results?',
      'What scientific explanation could account for the pattern?',
    ],
  }),
  set({
    id: 'bank-sci-34',
    name: 'Evaluate an Investigation',
    subject: 'Science',
    years: '9–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'How reliable are the results?',
      'What sources of error may have affected them?',
      'Was the method valid?',
      'What could be improved?',
      'What further investigation would strengthen the conclusion?',
    ],
  }),
  set({
    id: 'bank-sci-35',
    name: 'Build a Scientific Explanation',
    subject: 'Science',
    years: '7–10',
    skill: 'Inquiry',
    minutes: 10,
    prompts: [
      'What phenomenon are you explaining?',
      'Which scientific concepts are relevant?',
      'What evidence or example can you use?',
      'Link the evidence to the science.',
      'Finish with a clear explanation.',
    ],
  }),
  set({
    id: 'bank-sci-36',
    name: 'Practical Reflection',
    subject: 'Science',
    years: '7–10',
    skill: 'Reflection',
    minutes: 8,
    prompts: [
      'What were you trying to find out?',
      'What happened?',
      'What result was most important?',
      'Did anything unexpected occur?',
      'What would you change next time?',
    ],
  }),

  // General — 12
  set({
    id: 'bank-gen-37',
    name: 'Retrieval Warm-Up',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 8,
    prompts: [
      'What can you remember from last lesson?',
      'Write three important ideas.',
      'Which idea are you least certain about?',
      'Write one question you still have.',
    ],
  }),
  set({
    id: 'bank-gen-38',
    name: 'Before We Begin',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 8,
    prompts: [
      "What do you already know about today's topic?",
      'Where have you seen this before?',
      'What do you think we might learn today?',
      'What are you curious about?',
    ],
  }),
  set({
    id: 'bank-gen-39',
    name: 'Confidence Check',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 5,
    prompts: [
      'How confident are you right now? 1–5',
      'What part feels easiest?',
      'What part are you unsure about?',
    ],
  }),
  set({
    id: 'bank-gen-40',
    name: 'Find the Misconception',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 8,
    note: 'Works best with a statement or example on the board.',
    prompts: [
      'Read the statement or example.',
      'What do you think is wrong?',
      'Explain why.',
      'Rewrite or correct the idea in your own words.',
    ],
  }),
  set({
    id: 'bank-gen-41',
    name: 'Exit Ticket',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 5,
    prompts: [
      'What is one important thing you learned?',
      'What can you now do that you could not do before?',
      'What are you still unsure about?',
    ],
  }),
  set({
    id: 'bank-gen-42',
    name: 'Peer Feedback',
    subject: 'General',
    years: '7–12',
    skill: 'Reflection',
    minutes: 8,
    note: 'Works best when students can see a peer’s work.',
    prompts: [
      'What is working well in this piece?',
      'Point to one specific example.',
      'Where could the writer make their meaning clearer?',
      'Give one useful suggestion for the next draft.',
    ],
  }),
  set({
    id: 'bank-gen-43',
    name: 'Check Your Own Work',
    subject: 'General',
    years: '5–12',
    skill: 'Reflection',
    minutes: 8,
    prompts: [
      'What part are you most satisfied with?',
      'Where did you struggle?',
      'What feedback have you acted on?',
      'What is your next improvement?',
    ],
  }),
  set({
    id: 'bank-gen-44',
    name: 'Draft → Feedback → Redraft',
    subject: 'General',
    years: '7–12',
    skill: 'Writing',
    minutes: 12,
    note: 'Use after you’ve commented, or as a structure for Inbox feedback.',
    prompts: [
      'Submit the section you want feedback on.',
      'Read your teacher’s comment.',
      'Explain what you will change.',
      'Make the revision.',
      'Briefly explain how the revision improved your work.',
    ],
  }),
  set({
    id: 'bank-gen-45',
    name: 'Unpack a Key Word',
    subject: 'General',
    years: '5–10',
    skill: 'Reflection',
    minutes: 8,
    prompts: [
      'What do you think the word means?',
      'Use it in a sentence.',
      'What words are similar?',
      'What is an example?',
      'What is a non-example?',
    ],
  }),
  set({
    id: 'bank-gen-46',
    name: 'Compare & Contrast',
    subject: 'General',
    years: '5–10',
    skill: 'Inquiry',
    minutes: 8,
    prompts: [
      'What do the two things have in common?',
      'What is one important difference?',
      'Which difference matters most?',
      'What conclusion can you make from the comparison?',
    ],
  }),
  set({
    id: 'bank-gen-47',
    name: 'Quick Understanding Check',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 8,
    prompts: [
      "Explain today's idea in your own words.",
      'Give an example.',
      'What mistake might someone make?',
      "What question would you ask to test someone's understanding?",
    ],
  }),
  set({
    id: 'bank-gen-48',
    name: 'Independent Work Check-In',
    subject: 'General',
    years: 'All',
    skill: 'Reflection',
    minutes: 5,
    prompts: [
      'What are you working on right now?',
      'What have you completed?',
      'Where are you stuck, if anywhere?',
      'What will you do next?',
    ],
  }),
];

const YEAR_ORDER = ['5–6', '7–8', '9–10', '11–12'];

function expandYears(label) {
  const raw = String(label || '').replace(/-/g, '–').trim();
  if (!raw || raw === 'All') return new Set(YEAR_ORDER);
  if (YEAR_ORDER.includes(raw)) return new Set([raw]);
  const match = raw.match(/^(\d+)–(\d+)$/);
  if (!match) return new Set(YEAR_ORDER);
  const start = Number(match[1]);
  const end = Number(match[2]);
  const covered = new Set();
  for (const band of YEAR_ORDER) {
    const [a, b] = band.split('–').map(Number);
    if (a <= end && b >= start) covered.add(band);
  }
  return covered.size ? covered : new Set(YEAR_ORDER);
}

export function setMatchesFilters(set, subject, yearBand) {
  if (subject && subject !== 'All' && set.subject !== subject) return false;
  if (!yearBand || yearBand === 'All') return true;
  return expandYears(set.years).has(yearBand);
}

export function formatSetMeta(set) {
  const years = set.years === 'All' ? 'All years' : `Years ${set.years}`;
  const mins = set.minutes ? `~${set.minutes} min` : '';
  return [set.subject, years, set.skill, mins].filter(Boolean).join(' · ');
}

export function getBankSetById(id) {
  return QUESTION_SET_BANK.find((set) => set.id === id) || null;
}
