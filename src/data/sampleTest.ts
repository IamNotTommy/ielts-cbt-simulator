import type { Passage, WritingTask } from '../types';

/**
 * 演示内容全部为自撰文本，不含任何真题。
 * 仅用于呈现界面结构与交互（对应规格说明书证据分级之外的项目自带素材）。
 */

export const passages: Passage[] = [
  {
    label: 'Part 1',
    heading: 'Read the text below and answer questions 1 - 13.',
    title: 'The Rise of Urban Farming',
    paragraphs: [
      { tag: '', text: 'Urban farming, the practice of growing food within cities, has expanded rapidly over the past two decades. What began as small community gardens on vacant lots has evolved into a sector that includes rooftop greenhouses, vertical farms stacked inside warehouses, and hydroponic containers placed in supermarket car parks. Advocates argue that producing food closer to where it is eaten reduces transport emissions and gives city residents access to fresher vegetables.' },
      { tag: '', text: 'The economics of urban farming remain contested. A vertical farm can produce far more lettuce per square metre than a conventional field, but it relies on artificial lighting and climate control, both of which consume significant amounts of electricity. A 2021 study comparing a vertical farm in Newark with field agriculture in California found that the vertical farm used roughly eight times more energy per kilogram of produce. Supporters counter that renewable energy and more efficient LED lighting are steadily closing this gap.' },
      { tag: '', text: 'Beyond economics, urban farms often serve a social function. Community gardens in cities such as Detroit and Singapore have been credited with strengthening neighbourhood ties, providing educational programmes for schoolchildren, and offering therapeutic horticulture for elderly residents. Critics note, however, that commercial vertical farms, which are highly automated, create relatively few jobs and rarely engage the communities around them.' },
      { tag: '', text: 'Looking ahead, most analysts expect the sector to grow in a hybrid form: high-tech facilities producing leafy greens and herbs year-round, alongside lower-tech community projects focused on social value rather than profit. Whether urban farming can ever supply staple crops such as wheat or rice at scale remains, for now, an open question.' },
    ],
    groups: [
      {
        title: 'Questions 1 - 5',
        instruction: 'Do the following statements agree with the information given in the text? Choose TRUE, FALSE or NOT GIVEN.',
        questions: [
          { no: 1, type: 'tfng', stem: 'Urban farming first appeared in supermarkets.' },
          { no: 2, type: 'tfng', stem: 'Vertical farms need artificial lighting.' },
          { no: 3, type: 'tfng', stem: 'The Newark vertical farm used less energy than California field agriculture.' },
          { no: 4, type: 'tfng', stem: 'Community gardens in Singapore charge an entry fee.' },
          { no: 5, type: 'tfng', stem: 'Analysts agree that urban farms will soon supply wheat at scale.' },
        ],
      },
      {
        title: 'Questions 6 - 9',
        instruction: 'Complete the sentences below. Write NO MORE THAN TWO WORDS for each answer.',
        questions: [
          { no: 6, type: 'gapfill', gapPrefix: 'Hydroponic containers may be placed in supermarket', gapSuffix: '.', wordLimit: 2 },
          { no: 7, type: 'gapfill', gapPrefix: 'Growing food near consumers reduces', gapSuffix: 'emissions.', wordLimit: 2 },
          { no: 8, type: 'gapfill', gapPrefix: 'More efficient', gapSuffix: 'lighting is helping to close the energy gap.', wordLimit: 2 },
          { no: 9, type: 'gapfill', gapPrefix: 'Therapeutic horticulture is offered to', gapSuffix: 'residents.', wordLimit: 2 },
        ],
      },
      {
        title: 'Questions 10 - 13',
        instruction: 'Choose the correct answer.',
        questions: [
          { no: 10, type: 'single', stem: 'What is the writer\'s main point in paragraph two?', options: ['Vertical farming is always cheaper', 'The cost of urban farming is debatable', 'LED lighting wastes energy', 'Field agriculture is outdated'] },
          { no: 11, type: 'single', stem: 'According to the text, commercial vertical farms ...', options: ['employ many local workers', 'rarely involve nearby communities', 'are unprofitable everywhere', 'grow mainly staple crops'] },
          { no: 12, type: 'single', stem: 'The writer suggests the future of urban farming will be ...', options: ['purely commercial', 'purely community-based', 'a mixture of approaches', 'dependent on government aid'] },
          { no: 13, type: 'single', stem: 'The writer\'s overall tone is ...', options: ['enthusiastic', 'dismissive', 'balanced', 'confused'] },
        ],
      },
    ],
  },
  {
    label: 'Part 2',
    heading: 'Read the text below and answer questions 14 - 26.',
    title: 'How Cities Learn from Failure',
    paragraphs: [
      { tag: 'A', text: 'When the Millennium Bridge in London opened in June 2000, thousands of pedestrians crowded onto it within hours. The bridge began to sway sideways, unsettlingly enough that it was closed after just two days. Engineers eventually traced the problem to "synchronous lateral excitation": pedestrians unconsciously adjusted their steps to the bridge\'s movement, amplifying it. The fix — retrofitting dampers — cost millions of pounds, but the episode changed footbridge design worldwide.' },
      { tag: 'B', text: 'Failure in urban infrastructure is rarely wasted. After the 1995 Kobe earthquake exposed the weakness of older Japanese buildings, the country revised its seismic codes and invested in base-isolation technology. Cities as far away as San Francisco and Istanbul later borrowed these techniques. Engineers describe this as "failure-driven learning": each disaster writes a new page in the collective manual.' },
      { tag: 'C', text: 'Some cities institutionalise this learning. Rotterdam maintains a public register of infrastructure incidents, from minor flooding to crane accidents, each entry accompanied by an analysis of causes and remedies. The register is open to citizens, contractors and foreign delegations alike. Officials argue that transparency accelerates improvement, because no team wants its mistake to remain unexplained.' },
      { tag: 'D', text: 'Yet learning from failure faces obstacles. Legal liability discourages candour: engineers who admit errors may expose their employers to lawsuits. Political cycles also intervene; a mayor who inherits a failing project may prefer quiet fixes to public inquiries. And some failures are simply invisible — a bridge that never sways because it was over-engineered consumes resources that could have been spent elsewhere, but no one calls it a failure.' },
      { tag: 'E', text: 'Digital tools are beginning to change this picture. Sensors embedded in bridges and tunnels now stream continuous data, allowing engineers to detect anomalies long before they become visible. Singapore\'s virtual city model lets planners simulate the consequences of design choices, effectively failing on screen rather than on the street. Advocates call this "failing forward": making mistakes cheap, early and informative.' },
      { tag: 'F', text: 'The lesson urban planners draw is an old one, dressed in new technology. Cities that treat failure as information — rather than embarrassment — improve fastest. As one Rotterdam engineer put it, "A city that hides its mistakes is doomed to repeat them; a city that publishes them may yet teach the world."' },
    ],
    groups: [
      {
        title: 'Questions 14 - 19',
        instruction: 'Match each heading with the correct paragraph, A - F.',
        nb: true,
        questions: [
          { no: 14, type: 'matchingHeadings', stem: 'Paragraph A', options: ['i  A famous opening-day failure', 'ii  Making learning official', 'iii  Why some failures stay hidden', 'iv  Technology prevents future failures', 'v  Learning exported across borders', 'vi  A philosophy summarised'], paragraphs: ['A'] },
          { no: 15, type: 'matchingHeadings', stem: 'Paragraph B', options: ['i  A famous opening-day failure', 'ii  Making learning official', 'iii  Why some failures stay hidden', 'iv  Technology prevents future failures', 'v  Learning exported across borders', 'vi  A philosophy summarised'], paragraphs: ['B'] },
          { no: 16, type: 'matchingHeadings', stem: 'Paragraph C', options: ['i  A famous opening-day failure', 'ii  Making learning official', 'iii  Why some failures stay hidden', 'iv  Technology prevents future failures', 'v  Learning exported across borders', 'vi  A philosophy summarised'], paragraphs: ['C'] },
          { no: 17, type: 'matchingHeadings', stem: 'Paragraph D', options: ['i  A famous opening-day failure', 'ii  Making learning official', 'iii  Why some failures stay hidden', 'iv  Technology prevents future failures', 'v  Learning exported across borders', 'vi  A philosophy summarised'], paragraphs: ['D'] },
          { no: 18, type: 'matchingHeadings', stem: 'Paragraph E', options: ['i  A famous opening-day failure', 'ii  Making learning official', 'iii  Why some failures stay hidden', 'iv  Technology prevents future failures', 'v  Learning exported across borders', 'vi  A philosophy summarised'], paragraphs: ['E'] },
          { no: 19, type: 'matchingHeadings', stem: 'Paragraph F', options: ['i  A famous opening-day failure', 'ii  Making learning official', 'iii  Why some failures stay hidden', 'iv  Technology prevents future failures', 'v  Learning exported across borders', 'vi  A philosophy summarised'], paragraphs: ['F'] },
        ],
      },
      {
        title: 'Questions 20 and 21',
        instruction: 'Choose TWO letters from A-E. Which TWO obstacles to learning from failure are mentioned?',
        questions: [
          { no: 20, type: 'multiple', stem: 'Obstacles mentioned (choose TWO)', optionLetters: ['A', 'B', 'C', 'D', 'E'], options: ['fear of legal consequences', 'shortage of sensors', 'political pressure to avoid publicity', 'public indifference', 'failures that are not recognised as such'], maxSelect: 2 },
          { no: 21, type: 'multiple', stem: '(same answer set as Q20)', optionLetters: ['A', 'B', 'C', 'D', 'E'], options: [], maxSelect: 0 },
        ],
      },
      {
        title: 'Questions 22 - 26',
        instruction: 'Complete the summary below. Write NO MORE THAN TWO WORDS for each answer.',
        questions: [
          { no: 22, type: 'gapfill', gapPrefix: 'The Millennium Bridge swayed because of', gapSuffix: 'lateral excitation.', wordLimit: 2 },
          { no: 23, type: 'gapfill', gapPrefix: 'Kobe invested in', gapSuffix: 'technology after 1995.', wordLimit: 2 },
          { no: 24, type: 'gapfill', gapPrefix: 'Rotterdam keeps a public', gapSuffix: 'of incidents.', wordLimit: 2 },
          { no: 25, type: 'gapfill', gapPrefix: 'Sensors can detect', gapSuffix: 'before they are visible.', wordLimit: 2 },
          { no: 26, type: 'gapfill', gapPrefix: 'Singapore simulates failures in a', gapSuffix: 'city model.', wordLimit: 2 },
        ],
      },
    ],
  },
  {
    label: 'Part 3',
    heading: 'Read the text below and answer questions 27 - 40.',
    title: 'The Quiet Revolution in Sleep Science',
    paragraphs: [
      { tag: 'A', text: 'For most of the twentieth century, sleep was regarded as downtime — a passive state between periods of usefulness. Researchers who studied it occupied a small corner of physiology, and their findings rarely made headlines. That changed when studies began linking chronic sleep deprivation to heart disease, diabetes and impaired immunity.' },
      { tag: 'B', text: 'A turning point came with the discovery that sleep serves the brain\'s housekeeping. During deep sleep, the glymphatic system flushes metabolic waste — including beta-amyloid proteins associated with Alzheimer\'s disease — from brain tissue. The finding reframed sleep from passive rest to active maintenance, and gave public-health campaigns a vivid slogan: sleep is when the brain takes out its rubbish.' },
      { tag: 'C', text: 'Technology accelerated the field. Consumer wearables turned millions of wrists into data sources, producing datasets of unprecedented size. Although researchers caution that wrist-based tracking estimates sleep stages imperfectly, the sheer scale of the data has revealed population-level patterns — for instance, that people sleep measurably less during heatwaves.' },
      { tag: 'D', text: 'The workplace has begun to respond. Several Japanese firms have introduced "sleep bonuses" for employees who log sufficient rest, and some hospitals have redesigned shift rotations to protect circadian rhythms. Critics worry, however, that monitoring employees\' sleep crosses a privacy line, and that tying pay to biometric data creates perverse incentives to game the trackers.' },
      { tag: 'E', text: 'Education is another frontier. Studies in the United States found that delaying high-school start times by one hour raised attendance and, in some districts, test scores. Yet implementation is slow: bus schedules, parents\' working hours and sports fixtures all resist change. Sleep scientists have learned that biology is the easy part; logistics is hard.' },
      { tag: 'F', text: 'Looking forward, researchers are divided between optimists, who foresee personalised sleep prescriptions guided by genetics and wearables, and sceptics, who note that the basics — regular hours, darkness, cool rooms — remain unchanged for millennia. Perhaps the revolution is quiet precisely because its advice is so old-fashioned.' },
    ],
    groups: [
      {
        title: 'Questions 27 - 32',
        instruction: 'Match each statement with the correct paragraph, A - F. NB You may use any letter more than once.',
        nb: true,
        questions: [
          { no: 27, type: 'matchingInfo', stem: 'Sleep removes harmful proteins from the brain.', paragraphs: ['A', 'B', 'C', 'D', 'E', 'F'] },
          { no: 28, type: 'matchingInfo', stem: 'Large datasets showed weather affects sleep duration.', paragraphs: ['A', 'B', 'C', 'D', 'E', 'F'] },
          { no: 29, type: 'matchingInfo', stem: 'Practical arrangements obstruct scientific recommendations.', paragraphs: ['A', 'B', 'C', 'D', 'E', 'F'] },
          { no: 30, type: 'matchingInfo', stem: 'Financial rewards are offered for adequate rest.', paragraphs: ['A', 'B', 'C', 'D', 'E', 'F'] },
          { no: 31, type: 'matchingInfo', stem: 'Sleep research once attracted little attention.', paragraphs: ['A', 'B', 'C', 'D', 'E', 'F'] },
          { no: 32, type: 'matchingInfo', stem: 'New guidance may turn out to resemble ancient habits.', paragraphs: ['A', 'B', 'C', 'D', 'E', 'F'] },
        ],
      },
      {
        title: 'Questions 33 - 36',
        instruction: 'Do the following statements agree with the views of the writer? Choose YES, NO or NOT GIVEN.',
        questions: [
          { no: 33, type: 'tfng', stem: 'Wearables measure sleep stages with perfect accuracy.' },
          { no: 34, type: 'tfng', stem: 'Paying staff for sleeping well is ethically straightforward.' },
          { no: 35, type: 'tfng', stem: 'Later school start times improved attendance.' },
          { no: 36, type: 'tfng', stem: 'Genetics will soon replace conventional sleep advice.' },
        ],
      },
      {
        title: 'Questions 37 - 40',
        instruction: 'Complete the sentences below. Write NO MORE THAN TWO WORDS for each answer.',
        questions: [
          { no: 37, type: 'gapfill', gapPrefix: 'The', gapSuffix: 'system cleans the brain during deep sleep.', wordLimit: 2 },
          { no: 38, type: 'gapfill', gapPrefix: 'Hospitals redesigned', gapSuffix: 'rotations to protect circadian rhythms.', wordLimit: 2 },
          { no: 39, type: 'gapfill', gapPrefix: 'In some districts, later start times raised test', gapSuffix: '.', wordLimit: 2 },
          { no: 40, type: 'gapfill', gapPrefix: 'Cool', gapSuffix: 'are among the traditional basics of good sleep.', wordLimit: 2 },
        ],
      },
    ],
  },
];

export const writingTasks: WritingTask[] = [
  {
    part: 'Part 1',
    timing: 'You should spend about 20 minutes on this task. Write at least 150 words.',
    promptLines: [
      { text: 'The chart below shows the average hours per week that people in four countries spent on housework in 2005 and 2025.', style: 'italic' },
      { text: 'Summarise the information by selecting and reporting the main features, and make comparisons where relevant.', style: 'italic' },
    ],
    hasChart: true,
    minWords: 150,
  },
  {
    part: 'Part 2',
    timing: 'You should spend about 40 minutes on this task. Write at least 250 words.',
    promptLines: [
      { text: 'Write about the following topic:', style: 'plain' },
      { text: 'Some people believe that cities should ban private cars from their centres.', style: 'bold' },
      { text: 'However, others argue that such bans inconvenience residents and harm local businesses.', style: 'bold' },
      { text: 'Discuss both views and give your own opinion.', style: 'bold' },
      { text: 'Give reasons for your answer and include any relevant examples from your own knowledge and experience.', style: 'plain' },
    ],
    hasChart: false,
    minWords: 250,
  },
];

export const TFNG_OPTIONS = ['TRUE', 'FALSE', 'NOT GIVEN'];
export const YNNG_OPTIONS = ['YES', 'NO', 'NOT GIVEN'];
