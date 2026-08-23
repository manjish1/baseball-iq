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
   reduce to simple combinatorics (force-outs negating runs,
   cutoff-man reads, this league's no-stealing/no-bunting/no-IFR
   rules, etc.) — those live in SPECIAL_SCENARIOS below.
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

// A fielder standing right on the base he needs doesn't throw there — he just
// runs over and steps on it himself (most obviously the 1st baseman on a
// comebacker, but the same is true for 2B/3B fielding near their own bag).
const STEP_TEXT = { '1st': 'Run to 1st and step on the bag', '2nd': 'Step on 2nd yourself', '3rd': 'Step on 3rd yourself' };
const FIELDER_OWN_BASE = { '1B': '1st', '2B': '2nd', '3B': '3rd' };

function baseActionText(base, fielder) {
  if (fielder && FIELDER_OWN_BASE[fielder.key] === base) return STEP_TEXT[base];
  return THROW_TEXT[base];
}
function throwOptionsFor(fielder) {
  return Object.keys(THROW_TEXT).map(b => baseActionText(b, fielder));
}

const RUNNER_COMBOS = [
  { first:false, second:false, third:false, desc: 'Bases are empty' },
  { first:true,  second:false, third:false, desc: 'A runner is on 1st' },
  { first:false, second:true,  third:false, desc: 'A runner is on 2nd' },
  { first:false, second:false, third:true,  desc: 'A runner is on 3rd' },
  { first:true,  second:true,  third:false, desc: 'Runners are on 1st and 2nd' },
  { first:true,  second:false, third:true,  desc: 'Runners are on 1st and 3rd' },
  { first:false, second:true,  third:true,  desc: 'Runners are on 2nd and 3rd' },
  { first:true,  second:true,  third:true,  desc: 'The bases are loaded' }
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
function combinedThrowText(bases, fielder) {
  if (bases.length === 1) return baseActionText(bases[0], fielder);
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
    (rd, od, fl) => `You're on defense. ${rd}, ${od}. A ground ball is hit to the ${fl}. Where's the play at?`,
    (rd, od, fl) => `${rd}, ${od}. You're on defense. The ${fl} fields a grounder. Where's the play?`
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
            const correctText = combinedThrowText(validBases, fielder);
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
            const correctText = baseActionText('2nd', fielder);
            const explanation = oc === 1
              ? `That runner has to run because 1st is full — 2nd is the easy, sure out.`
              : `More than one runner is forced, but 2nd is still the easy out — no need to risk a longer throw for a fancier play.`;
            const level = oc === 1 ? 1 : oc === 2 ? 2 : 3;
            const distractors = shuffle([...throwOptionsFor(fielder).filter(b => b !== correctText), HOLD_TEXT]).slice(0, 3);
            push(combo, outs, fielder, tmpl, level, correctText, distractors, explanation);
          } else if (combo === basesEmpty) {
            // No HOLD_TEXT here on purpose: with the bases empty, holding the
            // ball has zero upside (no runner to protect against) and only
            // guarantees the batter reaches free — offering it as a choice
            // just looks like the 3B/SS "hold" rule flipping on you again.
            const correctText = baseActionText('1st', fielder);
            const explanation = `Nobody's on base yet — 1st is the only play, so you always make this out.`;
            const distractors = shuffle(throwOptionsFor(fielder).filter(b => b !== correctText)).slice(0, 3);
            push(combo, outs, fielder, tmpl, 1, correctText, distractors, explanation);
          } else if (FAR_THROW_FIELDERS.includes(fielder.key)) {
            // No force here, and this is the long throw across the diamond —
            // always correct to just hold the ball rather than risk an
            // overthrow. (Kept as one consistent answer at every level, so
            // the same-looking play never flips right/wrong on you later.)
            push(combo, outs, fielder, tmpl, oc === 1 ? 1 : 2, HOLD_TEXT,
              shuffle(throwOptionsFor(fielder)).slice(0, 3),
              `Nobody's forced to run here, and that's a long throw across the diamond — hold onto the ball instead of risking an overthrow.`);
          } else {
            // Short, easy throw (pitcher/2nd baseman) — safe even for young players.
            // (1st baseman also lands here when there's a runner on base and
            // no force: he doesn't throw to his own bag, he just steps on it.)
            const correctText = baseActionText('1st', fielder);
            const explanation = `1st base is open, so nobody else is forced to run — 1st base is the safe out.`;
            const level = oc === 1 ? 2 : 3;
            const distractors = shuffle([...throwOptionsFor(fielder).filter(b => b !== correctText), HOLD_TEXT]).slice(0, 3);
            push(combo, outs, fielder, tmpl, level, correctText, distractors, explanation);
          }
        }
      }
    }
  }
  return items;
}

// Describes the OTHER runners on base, excluding whichever base "you" are
// standing on — saying "You're on 1st. A runner is on 1st." is confusing
// nonsense, since that runner is you.
function otherRunnersClause(combo, exceptKey) {
  const others = [];
  if (combo.first && exceptKey !== 'first') others.push('1st');
  if (combo.second && exceptKey !== 'second') others.push('2nd');
  if (combo.third && exceptKey !== 'third') others.push('3rd');
  if (others.length === 0) return null;
  if (others.length === 1) return `A runner is also on ${others[0]}`;
  return `Runners are also on ${others.join(' and ')}`;
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
    (base, other, od, fl) => `You're on ${base}, ${od}.${other ? ' ' + other + '.' : ''} A ground ball is hit to the ${fl}. What do you do?`,
    (base, other, od, fl) => `${od}. You're on ${base}${other ? ', and ' + other.charAt(0).toLowerCase() + other.slice(1) : ''}. The ${fl} fields a grounder. What's your move?`
  ];
  // "Run to {next base}" and "run because you're forced/it's 2 outs" describe
  // the exact same physical action (sprint to the next base right now) — they
  // aren't two different answers, just two justifications for one action. So
  // there's a single "run" answer, always phrased as the destination, and the
  // explanation is what varies (forced vs. the 2-out rule).
  const OPT_RUN = (next) => `Run to ${next}`;
  const OPT_READ = `Wait and watch`;
  const OPT_FREEZE = `Stay on your base`;
  const OPT_TAGUP = `Tag up first`;

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
              correctText = OPT_RUN(base.next);
              explanation = `With 2 outs, always run hard — nothing to lose.`;
              level = 2;
            } else if (forced) {
              correctText = OPT_RUN(base.next);
              explanation = `The base behind you is full, so you have to run.`;
              level = oc === 1 ? 1 : oc === 2 ? 2 : 3;
            } else {
              correctText = OPT_READ;
              explanation = `No one is making you run — only go if it's clearly safe.`;
              level = oc === 1 ? 2 : 3;
            }
            const pool = [OPT_RUN(base.next), OPT_READ, OPT_FREEZE, OPT_TAGUP].filter(o => o !== correctText);
            const distractors = shuffle(pool).slice(0, 3);
            items.push(makeItem({
              level: Math.max(1, Math.min(5, level)),
              category: 'offense',
              outs,
              runners: { first: combo.first, second: combo.second, third: combo.third },
              hit: { type: 'ground', pos: fielder.key, label: 'Ground ball' },
              prompt: tmpl(base.label, otherRunnersClause(combo, base.key), OUTS_DESC[outs], fielder.label),
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
  // Two different decision points get two different phrasings: with less than
  // 2 outs, the question is about AFTER a confirmed catch (tag-up rules).
  // With 2 outs, a caught fly is the 3rd out regardless of what the runner
  // does — so there's nothing to decide "after" the catch. The real decision
  // is AT CONTACT, before anyone knows if it'll be caught, which is why that
  // version is phrased differently.
  const templatesCaught = [
    (base, od, of) => `You're on ${base} base, ${od}. A fly ball to ${of} is caught. What do you do?`,
    (base, od, of) => `${od}. Runner on ${base}, a fly ball to ${of} gets caught. What's the right move?`
  ];
  const templatesContact = [
    (base, od, of) => `You're on ${base} base, ${od}. A fly ball is hit to ${of}. What do you do right at contact?`,
    (base, od, of) => `${od}. Runner on ${base}, a fly ball is hit to ${of}. What's your move the instant it's hit?`
  ];
  const OPT_TAG = `Tag up, then run`;
  const OPT_CONTACT = `Take off running right at contact`;
  const OPT_WAIT = `Wait to see if it drops`;
  const OPT_STAY = `Stay on your base`;

  for (const base of bases) {
    for (let outs = 0; outs <= 2; outs++) {
      for (const of of OF) {
        const templates = outs === 2 ? templatesContact : templatesCaught;
        for (const tmpl of templates) {
          let correctText, explanation, level;
          if (outs === 2) {
            correctText = OPT_CONTACT;
            explanation = `With 2 outs, a caught fly ends the inning no matter what you do — so break hard at contact. If it drops, you've got a head start.`;
            level = 2;
          } else {
            correctText = OPT_TAG;
            explanation = `Wait for the catch, touch your base, then run.`;
            level = 1;
          }
          const pool = [OPT_TAG, OPT_CONTACT, OPT_WAIT, OPT_STAY].filter(o => o !== correctText);
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
    (zoneLabel, rd) => `You're on defense. ${rd}. A single is hit to ${zoneLabel}.`,
    (zoneLabel, rd) => `You're on defense. ${rd}. The batter rips one out to ${zoneLabel}.`
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

// ---------- DEFENSE: outfield fundamentals — backing up plays, popup footwork ----------
function genOutfieldFundamentals() {
  const items = [];

  // Each outfielder has a base they always back up on an infield throw there,
  // in case the throw skips past the infielder.
  const BACKUP_INFIELD = [
    { backupFielder: 'right fielder', baseLabel: '1st base', posKey: '1B' },
    { backupFielder: 'center fielder', baseLabel: '2nd base', posKey: '2B' },
    { backupFielder: 'left fielder', baseLabel: '3rd base', posKey: '3B' }
  ];
  const INFIELDERS_FLAVOR = ['shortstop', 'second baseman', 'third baseman', 'pitcher'];
  const backupTemplates = [
    (who, fl, baseLabel) => `You're the ${who}. The ${fl} fields a grounder and throws to ${baseLabel}. What's your job?`,
    (who, fl, baseLabel) => `You're playing ${who}. The ${fl} fields a ground ball and throws over to ${baseLabel}. What should you be doing?`
  ];
  const ALL_BACKUP_OPTIONS = ['Back up 1st base', 'Back up 2nd base', 'Back up 3rd base', 'Stay in position and watch'];

  for (const b of BACKUP_INFIELD) {
    for (const infielder of INFIELDERS_FLAVOR) {
      for (const tmpl of backupTemplates) {
        const correctText = `Back up ${b.baseLabel}`;
        const distractors = shuffle(ALL_BACKUP_OPTIONS.filter(o => o !== correctText)).slice(0, 3);
        items.push(makeItem({
          level: 3, category: 'defense', outs: 0,
          runners: { first:false, second:false, third:false },
          hit: { type: 'ground', pos: b.posKey, label: 'Ground ball' },
          prompt: tmpl(b.backupFielder, infielder, b.baseLabel),
          correctText, distractors,
          explanation: `The ${b.backupFielder} always backs up throws to ${b.baseLabel} on the infield, in case the throw gets away.`
        }));
      }
    }
  }

  // Outfielder-to-outfielder backup: whichever corner outfielder ISN'T
  // involved in a gap play should hustle over to back up the other two.
  const GAP_BACKUPS = [
    { gapLabel: 'the left-center field gap', backupFielder: 'right fielder', pos: 'CF' },
    { gapLabel: 'the right-center field gap', backupFielder: 'left fielder', pos: 'CF' }
  ];
  const gapTemplates = [
    (who, gapLabel) => `You're the ${who}. The ball is hit into ${gapLabel}. What do you do?`,
    (who, gapLabel) => `You're playing ${who} and the ball is hit to ${gapLabel}. What's your move?`
  ];
  const WRONG_GAP_OPTIONS = ['Stay in your position', 'Run in to cover the infield', 'Run toward home plate'];
  for (const g of GAP_BACKUPS) {
    for (const tmpl of gapTemplates) {
      items.push(makeItem({
        level: 3, category: 'defense', outs: 0,
        runners: { first:false, second:false, third:false },
        hit: { type: 'fly', pos: g.pos, label: 'Gap shot' },
        prompt: tmpl(g.backupFielder, g.gapLabel),
        correctText: 'Hustle over to back up the play',
        distractors: shuffle(WRONG_GAP_OPTIONS).slice(0, 3),
        explanation: `You're not the one making the play, so hustle over to back up your teammates in case the ball gets past them.`
      }));
    }
  }

  // Popup footwork: the first move should always be backward.
  const POPUP_POS = ['SS', '2B', '3B', '1B', 'LF', 'CF', 'RF'];
  const popupTemplates = [
    (fl) => `You're the ${fl}, and a popup goes up near you. What should your very first step be?`,
    (fl) => `You're playing ${fl}. A popup is hit near you. What's the right first move?`
  ];
  const POS_LABEL = { SS:'shortstop', '2B':'second baseman', '3B':'third baseman', '1B':'first baseman', LF:'left fielder', CF:'center fielder', RF:'right fielder' };
  for (const pos of POPUP_POS) {
    for (const tmpl of popupTemplates) {
      items.push(makeItem({
        level: 2, category: 'defense', outs: 0,
        runners: { first:false, second:false, third:false },
        hit: { type: 'fly', pos, label: 'Popup' },
        prompt: tmpl(POS_LABEL[pos]),
        correctText: 'A step backward',
        distractors: ['A step forward', 'Stand still and wait', 'Run straight in'],
        explanation: `Always take your first step back on a popup — it's a lot easier to come in for a short ball than to backpedal for one that sails over your head.`
      }));
    }
  }

  return items;
}

// ---------- SPECIAL RULE SCENARIOS (hand-written, high-IQ concepts) ----------
// Written to match actual NGBSA Peewee division rules (Spring '24): no
// stealing/leading off, no bunting, and NO Infield Fly Rule — all different
// from standard baseball, and worth teaching explicitly since kids often
// pick up the "regular" rules from watching pros or older siblings play.
const SPECIAL_SCENARIOS = [
  {
    level: 3, category: 'defense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'2B', label:'Infield popup' },
    prompts: [
      "You're on defense. Runners on 1st and 2nd, less than 2 outs. The batter hits an easy popup over the infield. What's the call?",
      "You're on defense, less than 2 outs, runners on 1st and 2nd. An easy popup goes up over the infield. What happens?"
    ],
    correctText: "No special rule — it must be caught for an out",
    distractors: ["Infield Fly — batter is automatically out", "Automatic double play", "Ground rule double"],
    explanation: "This league has NO Infield Fly Rule — it's just a regular fly ball. If it's dropped, nobody's out and the force is back on."
  },
  {
    level: 3, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'SS', label:'Infield popup' },
    prompts: [
      "You're on defense. Bases loaded, 1 out. The batter hits an easy popup over the infield. What's the call?",
      "You're on defense, 1 out, bases loaded. An easy popup goes up over the infield. What's the ruling?"
    ],
    correctText: "No special rule — it must be caught for an out",
    distractors: ["Infield Fly — batter is automatically out", "It's a force play only", "Ground rule double"],
    explanation: "No Infield Fly Rule in this league, even with the bases loaded — the defense has to actually catch it."
  },
  {
    level: 3, category: 'offense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'2B', label:'Infield popup' },
    prompts: [
      "You're a runner on 1st or 2nd. The batter pops one up over the infield. What should you do?",
      "You're one of the runners on 1st or 2nd. An easy popup goes up over the infield. What's the right move?"
    ],
    correctText: "Stay near your base and be ready to tag up",
    distractors: ["Run to the next base right away — the batter's automatically out", "Both run home", "Ignore the play"],
    explanation: "There's no Infield Fly Rule here, so the batter isn't out until it's caught — don't wander off your base."
  },
  {
    level: 5, category: 'defense', outs: 0, runners: { first:true, second:false, third:true },
    hit: null,
    prompts: [
      "You're on defense. Runners on 1st and 3rd, no outs. You field a grounder and freeze the runner on 3rd by threatening to throw there — then instead throw to 2nd to get the runner from 1st. What happens to the runner on 3rd?",
      "You're on defense, no outs, 1st and 3rd. You hold the ball on the runner at 3rd, then throw to 2nd for the runner coming from 1st instead. What about the runner on 3rd?"
    ],
    correctText: "He's free to run home",
    distractors: ["He's stuck at 3rd no matter what", "He's automatically out", "Play stops immediately"],
    explanation: "This league's freeze rule: once the defense makes a play on a different runner, the frozen runner is live again and can try to advance."
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
    hit: null,
    prompts: [
      "You're the batter. Runner on 2nd, no outs. You want to help move the runner to 3rd. What's your plan?",
      "You're the batter, no outs, runner on 2nd. You want to advance the runner. What's your plan?"
    ],
    correctText: "Hit away — bunting isn't allowed in this league",
    distractors: ["Lay down a sacrifice bunt", "Take the pitch and hope he steals", "Bunt it foul on purpose"],
    explanation: "Bunting is banned in this league, so the only way to move a runner over is to hit the ball."
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
    level: 3, category: 'offense', outs: 0, runners: { first:false, second:false, third:true },
    hit: null,
    prompts: [
      "You're the runner on 3rd, no outs. You're rounding for home and the catcher is blocked up waiting for the ball right in front of the plate. What must you do?",
      "You're on 3rd, no outs, heading for home. The catcher is set up in front of the plate with the ball coming. What are you required to do?"
    ],
    correctText: "Slide to avoid the catcher",
    distractors: ["Run through him", "Jump over him", "Stop and go back to 3rd"],
    explanation: "This league requires runners to slide on plays at 2nd, 3rd, and home — you can't just run into the fielder."
  },
  {
    level: 2, category: 'offense', outs: 0, runners: { first:true, second:false, third:false },
    hit: null,
    prompts: [
      "You're the runner on 1st, no outs. The pitcher is set and about to deliver the pitch. What are you allowed to do?",
      "You're on 1st, no outs, pitcher's about to throw. What can you legally do right now?"
    ],
    correctText: "Stay right on the bag until the ball is hit",
    distractors: ["Take a big secondary lead", "Try to steal 2nd", "Walk halfway to 2nd"],
    explanation: "No leading off and no stealing in this league — your foot can't leave the base until the ball is hit."
  },
  {
    level: 5, category: 'offense', outs: 0, runners: { first:true, second:false, third:true },
    hit: null,
    prompts: [
      "You're the runner on 3rd, no outs, with a runner also on 1st. The defense freezes you near the bag, then turns and throws to 2nd to get the runner from 1st instead. What should you do?",
      "You're on 3rd, no outs, with a runner also on 1st. The defense holds you at 3rd, then throws to 2nd for the other runner. What's your move?"
    ],
    correctText: "Take off for home — you're free now",
    distractors: ["Stay frozen at 3rd no matter what", "You're automatically out", "Wait for the umpire to wave you on"],
    explanation: "Once the defense makes a play on a different runner, you're no longer frozen and can try to score."
  },
  {
    level: 5, category: 'offense', outs: 0, runners: { first:false, second:true, third:false },
    hit: null,
    prompts: [
      "You're rounding the bases and, in the excitement, you miss stepping on 2nd base but keep going and touch 3rd. What happens?",
      "You round the bases, skip over 2nd base by accident, and touch 3rd instead. What's the result?"
    ],
    correctText: "The umpire can call you out — no appeal needed",
    distractors: ["Nothing, unless the defense appeals it", "You're safe since nobody complained", "You just have to go back and re-touch 2nd"],
    explanation: "In this league, missing a base is a judgment call the umpire makes on their own — the defense doesn't even need to appeal it like in regular baseball."
  },
  {
    level: 3, category: 'offense', outs: 0, runners: { first:false, second:true, third:false },
    hit: null,
    prompts: [
      "You're the runner on 2nd trying to beat a tag at 3rd. Are you allowed to slide in headfirst?",
      "You're on 2nd, sliding into 3rd to beat the throw. Can you go in headfirst?"
    ],
    correctText: "No — headfirst is only allowed going back to a base",
    distractors: ["Yes, headfirst is always fine", "Only if you're the tying run", "Only on the last out of the inning"],
    explanation: "Headfirst slides aren't allowed when advancing to a base in this league — feet first only. Headfirst is only okay when diving back to a base."
  },
  {
    level: 5, category: 'defense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'3B', label:'Popup near foul line' },
    prompts: [
      "You're on defense. Runners on 1st and 2nd, no outs. A popup drifts near the foul line and your fielder lets it drop untouched. What happens if it lands fair?",
      "You're on defense. A popup drifts toward the line, runners on 1st and 2nd. Your fielder lets it fall untouched and it lands in fair territory. What's the result?"
    ],
    correctText: "It's just a live fair ball — nobody's out",
    distractors: ["The batter is automatically out", "Automatic double play", "It's a foul ball no matter what"],
    explanation: "No Infield Fly Rule here — letting it drop doesn't create an out by itself. It's a live ball, and the defense still has to make a play."
  },
  {
    level: 5, category: 'offense', outs: 1, runners: { first:false, second:true, third:true },
    hit: { type:'ground', pos:'3B', label:'Sharp ground ball' },
    prompts: [
      "You're the runner on 3rd, with a runner also on 2nd, 1 out, 1st base open. A hard grounder is fielded deep by the third baseman. What do you do?",
      "You're on 3rd, 1 out, a runner also on 2nd, 1st open. A sharp grounder is fielded by the third baseman. What's your read?"
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
    level: 4, category: 'defense', outs: 0, runners: { first:false, second:true, third:false },
    hit: null,
    prompts: [
      "You're on defense. Runner on 2nd, no outs. Should your corner infielders crash in expecting a bunt?",
      "You're on defense, no outs, runner on 2nd. Do you need to guard against a bunt here?"
    ],
    correctText: "No — bunting isn't allowed in this league",
    distractors: ["Yes, always guard the bunt", "Only with 2 outs", "Only if the batter is left-handed"],
    explanation: "Since bunting is banned here, infielders can play back at normal depth instead of crashing in."
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
    level: 4, category: 'offense', outs: 0, runners: { first:false, second:true, third:false },
    hit: null,
    prompts: [
      "You're the runner on 2nd. A throw to 1st sails past the first baseman but stays in play near the fence. What can you do?",
      "You're on 2nd. An overthrow at 1st stays in play by the fence. What's your move?"
    ],
    correctText: "Try to advance — but it's at your own risk",
    distractors: ["Nothing, the ball is automatically dead", "You must stay on 2nd", "You're awarded 3rd for free"],
    explanation: "If an overthrow stays in the field of play, runners can try to advance, but the defense can still make a play — it's not a free base."
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
    hit: { type:'ground', pos:'P', label:'Comebacker' },
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
  ...genOutfieldFundamentals(),
  ...buildSpecialItems()
];
