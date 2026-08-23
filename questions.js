/* ============================================================
   Baseball IQ question engine.
   Instead of a fixed list, we generate hundreds of question
   PHRASINGS from a small set of correct, shared baseball rules
   (force-play logic, tag-up logic). This means the same concept
   gets asked many different ways (different fielder, different
   wording) so a player learns the underlying read instead of
   memorizing "answer B". Answers are kept short and simple —
   built for a young player learning the game.

   A smaller hand-written set covers special rules that don't
   reduce to simple combinatorics (infield fly rule, force-outs
   negating runs, squeeze plays, cutoff-man reads, etc.) — those
   live in SPECIAL_SCENARIOS below.
   ============================================================ */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Build a {prompt, choices, correct, explanation, level, category, outs, runners, hit}
// item from raw pieces, shuffling the choice order so the correct slot varies.
function makeItem({ level, category, outs, runners, hit, prompt, correctText, distractors, explanation }) {
  const options = shuffle([correctText, ...distractors]);
  return {
    level, category, outs, runners, hit, prompt: capitalize(prompt),
    choices: options,
    correct: options.indexOf(correctText),
    explanation
  };
}

const OUTS_DESC = ['no outs', '1 out', '2 outs'];
const THROW_TEXT = { '1st': 'Throw to 1st', '2nd': 'Throw to 2nd', '3rd': 'Throw to 3rd', home: 'Throw home' };
const THROW_OPTIONS = Object.values(THROW_TEXT);

const RUNNER_COMBOS = [
  { first:false, second:false, third:false, desc: 'bases empty' },
  { first:true,  second:false, third:false, desc: 'a runner on 1st' },
  { first:false, second:true,  third:false, desc: 'a runner on 2nd' },
  { first:false, second:false, third:true,  desc: 'a runner on 3rd' },
  { first:true,  second:true,  third:false, desc: 'runners on 1st and 2nd' },
  { first:true,  second:false, third:true,  desc: 'runners on 1st and 3rd' },
  { first:false, second:true,  third:true,  desc: 'runners on 2nd and 3rd' },
  { first:true,  second:true,  third:true,  desc: 'the bases loaded' }
];

const FIELDERS = [
  { key: 'SS', label: 'shortstop' },
  { key: '2B', label: 'second baseman' },
  { key: '3B', label: 'third baseman' },
  { key: '1B', label: 'first baseman' },
  { key: 'P',  label: 'pitcher' }
];

// Determine which base the *lead forced runner* must reach (or null if no force).
function leadForceBase(r) {
  if (r.first && r.second && r.third) return 'home';
  if (r.first && r.second) return '3rd';
  if (r.first) return '2nd';
  return null; // runner(s) on 2nd/3rd only, or bases empty -> nobody existing is forced
}

// With 2 outs, ANY out ends the inning, so every forced base plus 1st (the
// batter) is equally correct. Combine them into one honest answer instead of
// pretending only one base is right.
function allValidOutBases(r) {
  const valid = ['1st'];
  if (r.first) valid.push('2nd');
  if (r.first && r.second) valid.push('3rd');
  if (r.first && r.second && r.third) valid.push('home');
  return valid;
}
function combinedThrowText(bases) {
  if (bases.length === 1) return THROW_TEXT[bases[0]];
  if (bases.length === 2) return `Throw to ${bases[0]} or ${bases[1]}`;
  return `Throw to the nearest bag`;
}

function occupiedCount(r) { return (r.first?1:0) + (r.second?1:0) + (r.third?1:0); }

// ---------- DEFENSE: ground ball "where's the play" ----------
// Real coaching note: tiny kids can't reliably make a long throw across the
// diamond (like 3B or deep SS to 1st). When there's no force, young players
// are taught to just hold onto the ball rather than risk an overthrow — the
// "properly make the long throw" answer only becomes correct at higher
// (older/more skilled) levels. Fielders close to 1st (pitcher, 2nd baseman)
// don't have this problem even for young kids.
const HOLD_TEXT = 'Hold onto the ball';
const FAR_THROW_FIELDERS = ['3B', 'SS'];

function genDefenseGroundBall() {
  const items = [];
  const templates = [
    (rd, od, fl) => `You're on defense. There's ${rd}, ${od}. A ground ball is hit to the ${fl}. Where's the play at?`,
    (rd, od, fl) => `You're on defense, ${od}, with ${rd}. The ${fl} fields a grounder. Where's the play?`
  ];
  const WRONG_POOL_2OUT = ['Throw home no matter what', 'Always throw to 3rd', HOLD_TEXT];
  const basesEmpty = RUNNER_COMBOS[0];

  function push(combo, outs, fielder, tmpl, level, correctText, distractors, explanation) {
    items.push(makeItem({
      level: Math.max(1, Math.min(5, level)),
      category: 'defense',
      outs,
      runners: { first: combo.first, second: combo.second, third: combo.third },
      hit: { type: 'ground', pos: fielder.key, label: 'Ground ball' },
      prompt: tmpl(combo.desc, OUTS_DESC[outs], fielder.label),
      correctText, distractors, explanation
    }));
  }

  for (const combo of RUNNER_COMBOS) {
    const force = leadForceBase(combo);
    const oc = occupiedCount(combo);
    for (let outs = 0; outs <= 2; outs++) {
      for (const fielder of FIELDERS) {
        for (const tmpl of templates) {
          if (outs === 2) {
            const validBases = allValidOutBases(combo);
            const correctText = combinedThrowText(validBases);
            const explanation = validBases.length > 1
              ? `With 2 outs, any out ends the inning — take whichever base is easiest.`
              : `1st base is open, so 1st is the only real out.`;
            const level = [2, 3, 4, 5][validBases.length - 1];
            push(combo, outs, fielder, tmpl, level, correctText, shuffle(WRONG_POOL_2OUT).slice(0, 3), explanation);
          } else if (force) {
            // Easy out, not best out: whoever fields it, 2nd base is always
            // the short, sure throw. Going for a lead runner at 3rd or home
            // means a longer, harder throw — too much to ask of a young
            // fielder (especially a pitcher having to spin all the way
            // around), so we don't teach that as "the" answer here.
            const correctText = THROW_TEXT['2nd'];
            const explanation = oc === 1
              ? `That runner has to run because 1st is full — 2nd is the easy, sure out.`
              : `More than one runner is forced, but 2nd is still the easy out — no need to risk a longer throw for a fancier play.`;
            const level = oc === 1 ? 1 : oc === 2 ? 2 : 3;
            const distractors = shuffle([...THROW_OPTIONS.filter(b => b !== correctText), HOLD_TEXT]).slice(0, 3);
            push(combo, outs, fielder, tmpl, level, correctText, distractors, explanation);
          } else if (combo === basesEmpty) {
            const correctText = THROW_TEXT['1st'];
            const explanation = `Nobody's on base yet — 1st is the only play.`;
            const distractors = shuffle([...THROW_OPTIONS.filter(b => b !== correctText), HOLD_TEXT]).slice(0, 3);
            push(combo, outs, fielder, tmpl, 1, correctText, distractors, explanation);
          } else if (FAR_THROW_FIELDERS.includes(fielder.key)) {
            // No force here, and this is the long throw across the diamond —
            // always correct to just hold the ball rather than risk an
            // overthrow. (Kept as one consistent answer at every level, so
            // the same-looking play never flips right/wrong on you later.)
            push(combo, outs, fielder, tmpl, oc === 1 ? 1 : 2, HOLD_TEXT,
              shuffle(THROW_OPTIONS).slice(0, 3),
              `Nobody's forced to run here, and that's a long throw across the diamond — hold onto the ball instead of risking an overthrow.`);
          } else {
            // Short, easy throw (pitcher/2nd baseman) — safe even for young players.
            const correctText = THROW_TEXT['1st'];
            const explanation = `1st base is open, so nobody else is forced to run — 1st base is the safe out.`;
            const level = oc === 1 ? 2 : 3;
            const distractors = shuffle([...THROW_OPTIONS.filter(b => b !== correctText), HOLD_TEXT]).slice(0, 3);
            push(combo, outs, fielder, tmpl, level, correctText, distractors, explanation);
          }
        }
      }
    }
  }
  return items;
}

// ---------- OFFENSE: ground ball, runner's decision ----------
function genOffenseGroundBall() {
  const items = [];
  const bases = [
    { key: 'first',  label: '1st base', next: '2nd base' },
    { key: 'second', label: '2nd base', next: '3rd base' },
    { key: 'third',  label: '3rd base', next: 'home plate' }
  ];
  const templates = [
    (base, rd, od, fl) => `You're on ${base}. There's ${rd}, ${od}. A ground ball is hit to the ${fl}. What do you do?`,
    (base, rd, od, fl) => `${od}, ${rd}. You're on ${base} and the ${fl} fields a grounder. What's your move?`
  ];
  const OPT_FORCED = (next) => `Run to ${next}`;
  const OPT_READ = `Wait and watch`;
  const OPT_CONTACT2 = `Run no matter what`;
  const OPT_FREEZE = `Stay on your base`;

  for (const combo of RUNNER_COMBOS) {
    for (const base of bases) {
      if (!combo[base.key]) continue;
      let forced;
      if (base.key === 'first') forced = true;
      else if (base.key === 'second') forced = combo.first;
      else forced = combo.first && combo.second;

      for (let outs = 0; outs <= 2; outs++) {
        for (const fielder of FIELDERS.slice(0, 3)) {
          for (const tmpl of templates) {
            let correctText, explanation, level;
            const oc = occupiedCount(combo);
            if (outs === 2) {
              correctText = OPT_CONTACT2;
              explanation = `With 2 outs, always run hard — nothing to lose.`;
              level = 2;
            } else if (forced) {
              correctText = OPT_FORCED(base.next);
              explanation = `The base behind you is full, so you have to run.`;
              level = oc === 1 ? 1 : oc === 2 ? 2 : 3;
            } else {
              correctText = OPT_READ;
              explanation = `No one is making you run — only go if it's clearly safe.`;
              level = oc === 1 ? 2 : 3;
            }
            const pool = [OPT_FORCED(base.next), OPT_READ, OPT_CONTACT2, OPT_FREEZE].filter(o => o !== correctText);
            const distractors = shuffle(pool).slice(0, 3);
            items.push(makeItem({
              level: Math.max(1, Math.min(5, level)),
              category: 'offense',
              outs,
              runners: { first: combo.first, second: combo.second, third: combo.third },
              hit: { type: 'ground', pos: fielder.key, label: 'Ground ball' },
              prompt: tmpl(base.label, combo.desc, OUTS_DESC[outs], fielder.label),
              correctText, distractors, explanation
            }));
          }
        }
      }
    }
  }
  return items;
}

// ---------- OFFENSE: fly ball tag-up decisions ----------
// Kept simple on purpose: the core rule a young player needs is "wait for the
// catch and touch your base before running" — unless there are 2 outs, in
// which case you just go. No shallow/medium/deep judgment calls here.
function genOffenseFlyBall() {
  const items = [];
  const bases = [
    { key: 'second', label: '2nd', pos: 'second base' },
    { key: 'third',  label: '3rd', pos: 'third base' }
  ];
  const OF = [
    { key: 'LF', label: 'left field' },
    { key: 'CF', label: 'center field' },
    { key: 'RF', label: 'right field' }
  ];
  const templates = [
    (base, od, of) => `You're on ${base} base, ${od}. A fly ball to ${of} is caught. What do you do?`,
    (base, od, of) => `${od}. Runner on ${base}, a fly ball to ${of} gets caught. What's the right move?`
  ];
  const OPT_TAG = `Tag up, then run`;
  const OPT_STAY = `Stay on your base`;
  const OPT_GO2 = `Run right away`;
  const OPT_EARLY = `Run before it's caught`;

  for (const base of bases) {
    for (let outs = 0; outs <= 2; outs++) {
      for (const of of OF) {
        for (const tmpl of templates) {
          let correctText, explanation, level;
          if (outs === 2) {
            correctText = OPT_GO2;
            explanation = `With 2 outs, a catch ends the inning anyway — so just run hard.`;
            level = 2;
          } else {
            correctText = OPT_TAG;
            explanation = `Wait for the catch, touch your base, then run.`;
            level = 1;
          }
          const pool = [OPT_TAG, OPT_STAY, OPT_GO2, OPT_EARLY].filter(o => o !== correctText);
          items.push(makeItem({
            level, category: 'offense', outs,
            runners: { first:false, second: base.key==='second', third: base.key==='third' },
            hit: { type: 'fly', pos: of.key, label: 'Fly ball' },
            prompt: tmpl(base.label, OUTS_DESC[outs], of.label),
            correctText, distractors: shuffle(pool), explanation
          }));
        }
      }
    }
  }
  return items;
}

// ---------- DEFENSE: fly ball tag-up counterpart ----------
function genDefenseFlyBall() {
  const items = [];
  const bases = [
    { key: 'second', label: '2nd', dest: '3rd' },
    { key: 'third',  label: '3rd', dest: 'home' }
  ];
  const OF = [
    { key: 'LF', label: 'left field' }, { key: 'CF', label: 'center field' }, { key: 'RF', label: 'right field' }
  ];
  const correctText = 'Throw to the cutoff man';
  for (const base of bases) {
    for (const outs of [0, 1]) {
      for (const of of OF) {
        const distractors = shuffle(THROW_OPTIONS).slice(0, 3);
        items.push(makeItem({
          level: 2, category: 'defense', outs,
          runners: { first:false, second: base.key==='second', third: base.key==='third' },
          hit: { type: 'fly', pos: of.key, label: 'Fly ball, tagging' },
          prompt: `You're on defense. Runner on ${base.label}, ${OUTS_DESC[outs]}. A fly ball to ${of.label} is caught and the runner tags up. Where should the throw go?`,
          correctText, distractors,
          explanation: `An outfielder's throw always goes through the cutoff man first — he decides if it keeps going to ${base.dest === 'home' ? 'home plate' : base.dest + ' base'} or gets held up.`
        }));
      }
    }
  }
  return items;
}

// ---------- DEFENSE: outfield coverage — who's the cutoff man, who covers 2nd ----------
// Simplified rule of thumb: left/center field hits relay through the shortstop
// (so the second baseman covers 2nd); right field hits relay through the
// first baseman (so the shortstop covers 2nd).
function genDefenseCoverage() {
  const items = [];
  const ZONES = [
    { key: 'LF', label: 'left field', cutoff: 'Shortstop', covers2nd: 'Second baseman' },
    { key: 'CF', label: 'center field', cutoff: 'Shortstop', covers2nd: 'Second baseman' },
    { key: 'RF', label: 'right field', cutoff: 'First baseman', covers2nd: 'Shortstop' }
  ];
  const FLAVORS = [
    (zoneLabel, rd) => `You're on defense. A single is hit to ${zoneLabel}, with ${rd}.`,
    (zoneLabel, rd) => `You're on defense, with ${rd}. The batter rips one out to ${zoneLabel}.`
  ];
  const FLAVOR_RUNNERS = [RUNNER_COMBOS[0], RUNNER_COMBOS[2], RUNNER_COMBOS[5]];
  const ALL_FIELDERS = ['Pitcher', 'Catcher', 'First baseman', 'Second baseman', 'Third baseman', 'Shortstop'];

  for (const zone of ZONES) {
    for (const flavor of FLAVORS) {
      for (const rd of FLAVOR_RUNNERS) {
        const runners = { first: rd.first, second: rd.second, third: rd.third };

        const cutoffDistractors = shuffle(ALL_FIELDERS.filter(f => f !== zone.cutoff)).slice(0, 3);
        items.push(makeItem({
          level: 3, category: 'defense', outs: 0, runners,
          hit: { type: 'line', pos: zone.key, label: 'Single' },
          prompt: `${flavor(zone.label, rd.desc)} Who's the cutoff man for the throw?`,
          correctText: zone.cutoff, distractors: cutoffDistractors,
          explanation: `On a ball to ${zone.label}, the ${zone.cutoff.toLowerCase()} lines up as the cutoff man.`
        }));

        const coverDistractors = shuffle(ALL_FIELDERS.filter(f => f !== zone.covers2nd)).slice(0, 3);
        items.push(makeItem({
          level: 3, category: 'defense', outs: 0, runners,
          hit: { type: 'line', pos: zone.key, label: 'Single' },
          prompt: `${flavor(zone.label, rd.desc)} Who covers 2nd base?`,
          correctText: zone.covers2nd, distractors: coverDistractors,
          explanation: `On a ball to ${zone.label}, the ${zone.cutoff.toLowerCase()} runs out for the relay, so the ${zone.covers2nd.toLowerCase()} covers 2nd base.`
        }));
      }
    }
  }
  return items;
}

// ---------- SPECIAL RULE SCENARIOS (hand-written, high-IQ concepts) ----------
const SPECIAL_SCENARIOS = [
  {
    level: 3, category: 'defense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'2B', label:'Infield popup' },
    prompts: [
      "You're on defense. Runners on 1st and 2nd, less than 2 outs. The batter hits an easy popup over the infield. What's the call?",
      "You're on defense, less than 2 outs, runners on 1st and 2nd. An easy popup goes up over the infield. What happens?"
    ],
    correctText: "Infield Fly — batter is out",
    distractors: ["Not a special play", "Automatic double play", "Ground rule double"],
    explanation: "Runners on 1st and 2nd, less than 2 outs, easy popup: the batter is out no matter what."
  },
  {
    level: 3, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'SS', label:'Infield popup' },
    prompts: [
      "You're on defense. Bases loaded, 1 out. The batter hits an easy popup over the infield. What's the call?",
      "You're on defense, 1 out, bases loaded. An easy popup goes up over the infield. What's the ruling?"
    ],
    correctText: "Infield Fly — batter is out",
    distractors: ["Not a special play", "It's a force play only", "Ground rule double"],
    explanation: "Bases loaded with less than 2 outs is also an Infield Fly — same rule."
  },
  {
    level: 3, category: 'offense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'2B', label:'Infield popup (fly called)' },
    prompts: [
      "You're a runner on 1st or 2nd. Infield Fly is called on a popup. What should you do?",
      "You're one of the runners on 1st or 2nd when the umpire calls Infield Fly on a popup. What's the right move?"
    ],
    correctText: "Stay near your base",
    distractors: ["Sprint to the next base", "Both run home", "Ignore the play"],
    explanation: "The batter's already out, so you don't have to run. Tag up if you want to move up."
  },
  {
    level: 4, category: 'defense', outs: 1, runners: { first:true, second:false, third:true },
    hit: null,
    prompts: [
      "You're the catcher. 1st and 3rd, 1 out. The runner on 1st takes off for 2nd. The runner on 3rd is inching down the line. What should you do?",
      "You're the catcher, runners on 1st and 3rd, 1 out. 1st tries to steal 2nd, but 3rd is drifting off the bag. What's your read?"
    ],
    correctText: "Check 3rd before throwing",
    distractors: ["Always throw to 2nd", "Throw to 3rd right away", "Do nothing at all"],
    explanation: "Never let a run score just to get the runner stealing 2nd."
  },
  {
    level: 4, category: 'defense', outs: 0, runners: { first:false, second:true, third:false },
    hit: { type:'ground', pos:'CF', label:'Single to CF' },
    prompts: [
      "You're the outfielder. Runner on 2nd, no outs. A single to center field scores him. Who do you throw to?",
      "You're the outfielder, no outs, runner on 2nd scores on your single to center. Where should your throw go first?"
    ],
    correctText: "Throw to the cutoff man",
    distractors: ["Throw straight home", "Throw to 2nd", "Throw to 1st"],
    explanation: "The cutoff man helps the defense decide where the throw should really go."
  },
  {
    level: 4, category: 'defense', outs: 0, runners: { first:true, second:false, third:true },
    hit: { type:'ground', pos:'RF', label:'Single to RF' },
    prompts: [
      "You're the cutoff man. Runners on 1st and 3rd, no outs. A single to right scores the run and the other runner takes 2nd. What do you do?",
      "You're the cutoff man, no outs, 1st and 3rd. A single to right scores the run. What's your job?"
    ],
    correctText: "Line up for a cutoff throw",
    distractors: ["Stand at 2nd base", "Stand in the outfield", "Stand behind home"],
    explanation: "If the run can't be stopped, the cutoff man can still get the other runner."
  },
  {
    level: 3, category: 'offense', outs: 0, runners: { first:false, second:true, third:false },
    hit: { type:'bunt', pos:'3B', label:'Sac bunt' },
    prompts: [
      "You're the batter. Runner on 2nd, no outs. Your coach calls for a sacrifice bunt. What's the goal?",
      "You're the batter, no outs, runner on 2nd. The bunt sign is on. Why?"
    ],
    correctText: "Move the runner to 3rd",
    distractors: ["Get a hit only", "Steal 3rd instead", "Take the pitch"],
    explanation: "A bunt can trade an out to move the runner closer to home."
  },
  {
    level: 3, category: 'defense', outs: 0, runners: { first:true, second:false, third:false },
    hit: { type:'line', pos:'SS', label:'Line drive (caught)' },
    prompts: [
      "You're on defense. Runner on 1st, no outs. A line drive is caught by the shortstop. What's the best play next?",
      "You're on defense. No outs, runner on 1st takes off as a line drive is caught by the shortstop. What's next?"
    ],
    correctText: "Check 1st base",
    distractors: ["Throw home", "Do nothing else", "Throw to 3rd"],
    explanation: "If the runner left early, throwing to 1st is an easy second out."
  },
  {
    level: 3, category: 'offense', outs: 1, runners: { first:true, second:false, third:false },
    hit: { type:'line', pos:'SS', label:'Line drive (caught)' },
    prompts: [
      "You're the runner on 1st, 1 out. A hard line drive is caught by the shortstop. What should you do?",
      "You're on 1st, 1 out. A line drive gets caught by the shortstop. What now?"
    ],
    correctText: "Get back to 1st fast",
    distractors: ["Keep running to 2nd", "Stop and watch", "Run to 3rd"],
    explanation: "If you left too early, hurry back before you're doubled off."
  },
  {
    level: 4, category: 'offense', outs: 0, runners: { first:true, second:false, third:false },
    hit: null,
    prompts: [
      "You're the runner on 1st, no outs. The batter hits it deep to the gap — might be a hit, might be caught. What's your first move?",
      "You're on 1st, no outs. Your teammate smacks one to the gap. What's your first move?"
    ],
    correctText: "Wait, then run if it's a hit",
    distractors: ["Sprint to 2nd right away", "Freeze on 1st", "Tag up like it's caught"],
    explanation: "Watch first to see if it drops, then take off."
  },
  {
    level: 4, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'CF', label:'Fly ball' },
    prompts: [
      "You're on defense. Bases loaded, 1 out. A fly ball is caught and the runner from 3rd tags up. What's your best play?",
      "You're on defense, 1 out, bases loaded. A fly ball is caught and 3rd tags for home. What do you do?"
    ],
    correctText: "Throw to the cutoff man",
    distractors: ["Throw to 1st", "Throw to 2nd", "Don't throw anywhere"],
    explanation: "An outfielder's throw home always goes through the cutoff man first, so the defense can react."
  },
  {
    level: 4, category: 'defense', outs: 0, runners: { first:false, second:true, third:false },
    hit: { type:'bunt', pos:'3B', label:'Bunt' },
    prompts: [
      "You're on defense. Runner on 2nd, no outs. The batter bunts toward third. Where's the play?",
      "You're on defense, no outs, runner on 2nd. A bunt rolls toward third. What's your move?"
    ],
    correctText: "Throw to 1st",
    distractors: ["Throw to 3rd", "Throw home", "Ignore the bunt"],
    explanation: "The runner on 2nd isn't forced, so take the easy out at first."
  },
  {
    level: 3, category: 'offense', outs: 1, runners: { first:true, second:false, third:false },
    hit: { type:'bunt', pos:'1B', label:'Sac bunt' },
    prompts: [
      "You're the runner on 1st, 1 out. Your teammate lays down a sacrifice bunt. What must you do?",
      "You're on 1st, 1 out. Your teammate bunts. What are you required to do?"
    ],
    correctText: "Run to 2nd",
    distractors: ["Stay on 1st", "Run to 3rd", "Go to the dugout"],
    explanation: "The batter needs 1st base, so you have to move up."
  },
  {
    level: 5, category: 'defense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'3B', label:'Popup near foul line' },
    prompts: [
      "You're on defense. Runners on 1st and 2nd, no outs. Infield Fly is already called on a popup near the foul line, and your fielder lets it drop. What happens?",
      "You're on defense. Infield Fly is already called on a popup near the line, runners on 1st and 2nd. Your fielder lets it fall. What's the result?"
    ],
    correctText: "Still out, unless it goes foul",
    distractors: ["Automatic double play", "Batter is safe", "It's a hit"],
    explanation: "The batter is out either way — unless the ball rolls foul first."
  },
  {
    level: 5, category: 'offense', outs: 1, runners: { first:false, second:true, third:true },
    hit: { type:'ground', pos:'3B', label:'Sharp ground ball' },
    prompts: [
      "You're the runner on 3rd. Runners on 2nd and 3rd, 1 out, 1st base open. A hard grounder is fielded deep by the third baseman. What do you do?",
      "You're on 3rd, 1 out, runners on 2nd and 3rd, 1st open. A sharp grounder is fielded by the third baseman. What's your read?"
    ],
    correctText: "Go only if it's safe",
    distractors: ["Always run home", "Always stay", "Run to the dugout"],
    explanation: "No one is forcing you, so don't run into an easy out."
  },
  {
    level: 5, category: 'defense', outs: 1, runners: { first:true, second:true, third:false },
    hit: { type:'line', pos:'1B', label:'Line drive (caught)' },
    prompts: [
      "You're on defense. Runners on 1st and 2nd, 1 out. A line drive is caught by the first baseman and both runners had taken off. What's the smartest play?",
      "You're on defense. 1 out, 1st and 2nd both running on a line drive that's caught at first. What's your best play?"
    ],
    correctText: "Get 2 outs, then throw to 2nd",
    distractors: ["Throw home", "Take one out only", "Throw to 3rd only"],
    explanation: "If both runners left early, you might turn it into three outs."
  },
  {
    level: 5, category: 'offense', outs: 0, runners: { first:false, second:false, third:true },
    hit: { type:'bunt', pos:'H', label:'Suicide squeeze' },
    prompts: [
      "You're the batter. Runner on 3rd, no outs, suicide squeeze is on — he's already running home. What must you do?",
      "You're the batter, no outs, 3rd base, suicide squeeze called. Your teammate is sprinting home. What's your job?"
    ],
    correctText: "Bunt it no matter what",
    distractors: ["Take the pitch", "Swing for a hit", "Bunt only strikes"],
    explanation: "Your teammate is already running home — you must make contact."
  },
  {
    level: 5, category: 'defense', outs: 2, runners: { first:true, second:false, third:true },
    hit: { type:'ground', pos:'2B', label:'Ground ball' },
    prompts: [
      "You're on defense. Runners on 1st and 3rd, 2 outs. A ground ball goes to the second baseman. Where's the play, and does the run from 3rd count?",
      "You're on defense, 2 outs, 1st and 3rd. A grounder is hit to second. If you get the force, does the run from 3rd still count?"
    ],
    correctText: "Throw to 1st — run doesn't count",
    distractors: ["Throw home instead", "Throw to 3rd", "The run always counts"],
    explanation: "If the last out is a force play, any run on that play doesn't count."
  },
  {
    level: 5, category: 'offense', outs: 2, runners: { first:true, second:false, third:true },
    hit: { type:'ground', pos:'2B', label:'Ground ball' },
    prompts: [
      "You're the batter-runner. Runners on 1st and 3rd, 2 outs. You hit a ground ball to second and get forced out at 1st. Does the run from 3rd count?",
      "You're the batter-runner, 2 outs, 1st and 3rd. You're forced out at 1st on a grounder. Does the run from 3rd count?"
    ],
    correctText: "No, the run doesn't count",
    distractors: ["Yes, it always counts", "Only if he's fast", "The umpire decides"],
    explanation: "A force out for the final out wipes out the run, no matter the timing."
  },
  {
    level: 5, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'RF', label:'Fly ball' },
    prompts: [
      "You're on defense. Bases loaded, 1 out. A fly ball to right field is caught. Every runner tags up. Where should your throw go?",
      "You're on defense, 1 out, bases loaded, a fly ball to right is caught and all three tag up. Where should your throw go?"
    ],
    correctText: "Throw to the cutoff man",
    distractors: ["Throw to 2nd", "Throw to 1st", "Don't throw anywhere"],
    explanation: "The throw from the outfield goes through the cutoff man, who then decides where it needs to go — stopping the run matters most."
  },
  {
    level: 4, category: 'offense', outs: 0, runners: { first:true, second:false, third:false },
    hit: null,
    prompts: [
      "You're the runner on 1st, no outs, you've taken a big lead. The pitcher spins and throws behind you to 1st. What should you do?",
      "You're on 1st, no outs, big lead taken. The pitcher wheels and throws over to pick you off. What now?"
    ],
    correctText: "Get back to base fast",
    distractors: ["Try to steal anyway", "Freeze and hope", "Run toward the pitcher"],
    explanation: "Getting picked off wastes an out — hustle back safely."
  },
  {
    level: 2, category: 'offense', outs: 0, runners: { first:false, second:false, third:false },
    hit: null,
    prompts: [
      "You're the runner rounding 3rd base and your coach gives you a stop sign. What should you do?",
      "You're rounding third, and your coach puts both hands up (stop sign). What's your move?"
    ],
    correctText: "Stop at 3rd",
    distractors: ["Run home anyway", "Slow down but keep going", "Go back to 2nd"],
    explanation: "Your coach can see the ball better than you can — trust the stop sign."
  },
  {
    level: 2, category: 'defense', outs: 0, runners: { first:false, second:false, third:true },
    hit: { type:'ground', pos:'1B', label:'Comebacker' },
    prompts: [
      "You're on defense. Runner on 3rd only, no outs. A slow roller is fielded by the pitcher. What's the play?",
      "You're on defense, no outs, runner on 3rd. The pitcher fields a comebacker. Where's the safe out?"
    ],
    correctText: "Throw to 1st",
    distractors: ["Throw home", "Throw to 3rd", "Throw to 2nd"],
    explanation: "The runner on 3rd isn't forced, so take the easy out at first."
  }
];

function buildSpecialItems() {
  const items = [];
  for (const s of SPECIAL_SCENARIOS) {
    for (const prompt of s.prompts) {
      items.push(makeItem({
        level: s.level, category: s.category, outs: s.outs, runners: s.runners, hit: s.hit,
        prompt, correctText: s.correctText, distractors: s.distractors, explanation: s.explanation
      }));
    }
  }
  return items;
}

const QUESTION_BANK = [
  ...genDefenseGroundBall(),
  ...genOffenseGroundBall(),
  ...genOffenseFlyBall(),
  ...genDefenseFlyBall(),
  ...genDefenseCoverage(),
  ...buildSpecialItems()
];
