/* ============================================================
   Baseball IQ question engine.
   Instead of a fixed list, we generate hundreds of question
   PHRASINGS from a small set of correct, shared baseball rules
   (force-play logic, tag-up logic). This means the same concept
   gets asked many different ways (different fielder, different
   depth, different wording) so a player learns the underlying
   read instead of memorizing "answer B".

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

// Build a {prompt, choices, correct, explanation, level, category, outs, runners, hit}
// item from raw pieces, shuffling the choice order so the correct slot varies.
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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
const BASE_NAMES = ['1st base', '2nd base', '3rd base', 'home plate'];

const RUNNER_COMBOS = [
  { first:false, second:false, third:false, desc: 'Bases empty' },
  { first:true,  second:false, third:false, desc: 'Runner on 1st' },
  { first:false, second:true,  third:false, desc: 'Runner on 2nd only (1st base open)' },
  { first:false, second:false, third:true,  desc: 'Runner on 3rd only (1st and 2nd open)' },
  { first:true,  second:true,  third:false, desc: 'Runners on 1st and 2nd' },
  { first:true,  second:false, third:true,  desc: 'Runners on 1st and 3rd' },
  { first:false, second:true,  third:true,  desc: 'Runners on 2nd and 3rd (1st base open)' },
  { first:true,  second:true,  third:true,  desc: 'Bases loaded' }
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
  if (r.first && r.second) return '3rd base';
  if (r.first) return '2nd base';
  return null; // runner(s) on 2nd/3rd only, or bases empty -> nobody existing is forced
}

function occupiedCount(r) { return (r.first?1:0) + (r.second?1:0) + (r.third?1:0); }

// ---------- DEFENSE: ground ball "where's the play" ----------
function genDefenseGroundBall() {
  const items = [];
  const templates = [
    (rd, od, fl) => `${rd}, ${od}. Ground ball to the ${fl}. Where's the play?`,
    (rd, od, fl) => `${od}, ${rd}. A grounder is hit right to the ${fl}. What's the smartest out for the defense?`
  ];
  for (const combo of RUNNER_COMBOS) {
    const force = leadForceBase(combo);
    const oc = occupiedCount(combo);
    for (let outs = 0; outs <= 2; outs++) {
      for (const fielder of FIELDERS) {
        for (const tmpl of templates) {
          let correctText, explanation, level;
          if (outs === 2) {
            correctText = '1st base';
            explanation = force
              ? `With 2 outs, any force out ends the inning — take the closest, easiest one (usually 1st).`
              : `With 2 outs and 1st base open, there's no force anywhere — 1st base is the sure out.`;
            level = Math.min(5, 2 + Math.ceil(oc / 2));
          } else if (force) {
            correctText = force;
            explanation = force === 'home'
              ? `Bases loaded — every runner is forced, including at home. Get the lead runner at the plate.`
              : `The lead runner is forced to advance because the base(s) behind him are occupied — that's the most valuable out.`;
            level = 1 + oc; // empty/1 runner handled separately below (force null)
          } else {
            correctText = '1st base';
            explanation = combo.first
              ? `No force situation matches here.`
              : `1st base is open, so nobody on 2nd or 3rd is forced to run — the only guaranteed out is the batter at 1st.`;
            level = combo === RUNNER_COMBOS[0] ? 1 : 2 + Math.max(0, oc - 1);
          }
          const distractors = shuffle(BASE_NAMES.filter(b => b !== correctText)).slice(0, 3);
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
    (base, rd, od, fl) => `You're the runner on ${base}. ${rd}, ${od}. Ground ball is hit to the ${fl}. What should you do?`,
    (base, rd, od, fl) => `${od}. ${rd}, and you're the one standing on ${base}. A grounder is hit to the ${fl}. What's your move?`
  ];
  const OPT_FORCED = (next) => `Run hard toward ${next} — you're forced to go`;
  const OPT_READ = `Read the play first — you're not forced, so advance only if it's safe`;
  const OPT_CONTACT2 = `Go on contact no matter what — with 2 outs there's nothing to lose`;
  const OPT_FREEZE = `Freeze on your base and don't move`;

  for (const combo of RUNNER_COMBOS) {
    for (const base of bases) {
      if (!combo[base.key]) continue;
      // is THIS runner forced? He's forced if all bases behind him (toward home... no, toward 1st) are occupied.
      let forced;
      if (base.key === 'first') forced = true; // runner on 1st is always forced (batter behind him)
      else if (base.key === 'second') forced = combo.first;
      else forced = combo.first && combo.second;

      for (let outs = 0; outs <= 2; outs++) {
        for (const fielder of FIELDERS.slice(0, 3)) {
          for (const tmpl of templates) {
            let correctText, explanation, level;
            if (outs === 2) {
              correctText = OPT_CONTACT2;
              explanation = `With 2 outs, every runner goes hard on contact — a caught ball ends the inning regardless, so there's no risk in running.`;
              level = 2 + occupiedCount(combo);
            } else if (forced) {
              correctText = OPT_FORCED(base.next);
              explanation = `You have to vacate your base because a trailing runner (or the batter) is entitled to it — standing still just makes you an easy force out.`;
              level = 1 + occupiedCount(combo);
            } else {
              correctText = OPT_READ;
              explanation = `Nobody is forcing you to run since the base behind you is open — take off only if you're sure it's safe.`;
              level = 2 + occupiedCount(combo);
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
function genOffenseFlyBall() {
  const items = [];
  const bases = [
    { key: 'second', label: '2nd', pos: 'second base' },
    { key: 'third',  label: '3rd', pos: 'third base' }
  ];
  const depths = ['shallow', 'medium', 'deep'];
  const OF = [
    { key: 'LF', label: 'left field' },
    { key: 'CF', label: 'center field' },
    { key: 'RF', label: 'right field' }
  ];
  const templates = [
    (base, od, depth, of) => `You're on ${base} base, ${od}. A ${depth} fly ball to ${of} is caught. What should you do?`,
    (base, od, depth, of) => `${od}. Runner on ${base}, ${depth} fly ball hit to ${of} — it's caught. What's the right read?`
  ];
  const OPT_STAY = `Stay at the bag — it's too shallow to tag and advance safely`;
  const OPT_MED = `Tag up, then read the throw — advance only if it's clearly safe`;
  const OPT_DEEP = `Tag up and go hard the instant it's caught — it's deep enough`;
  const OPT_2OUT = `Get a big secondary lead and go hard at contact — if it's caught, the inning's over anyway`;

  for (const base of bases) {
    for (const depth of depths) {
      for (let outs = 0; outs <= 2; outs++) {
        for (const of of OF) {
          for (const tmpl of templates) {
            let correctText, explanation, level;
            if (outs === 2) {
              correctText = OPT_2OUT;
              explanation = `With 2 outs, a caught fly ends the inning no matter what you do — so you break hard at contact with nothing to lose.`;
              level = 4;
            } else if (depth === 'shallow') {
              correctText = OPT_STAY;
              explanation = `Too shallow — an outfielder charging in has an easy throw to double you off if you go.`;
              level = 1;
            } else if (depth === 'deep') {
              correctText = OPT_DEEP;
              explanation = `That's plenty deep — tag up and take the extra base.`;
              level = 2;
            } else {
              correctText = OPT_MED;
              explanation = `Medium depth is a judgment call — tag up, watch the throw, and only commit if it's clearly safe.`;
              level = 3;
            }
            const pool = [OPT_STAY, OPT_MED, OPT_DEEP, OPT_2OUT].filter(o => o !== correctText);
            items.push(makeItem({
              level, category: 'offense', outs,
              runners: { first:false, second: base.key==='second', third: base.key==='third' },
              hit: { type: 'fly', pos: of.key, label: `${depth[0].toUpperCase()+depth.slice(1)} fly` },
              prompt: tmpl(base.label, OUTS_DESC[outs], depth, of.label),
              correctText, distractors: shuffle(pool), explanation
            }));
          }
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
    { key: 'second', label: '2nd', dest: '3rd base' },
    { key: 'third',  label: '3rd', dest: 'home plate' }
  ];
  const OF = [
    { key: 'LF', label: 'left field' }, { key: 'CF', label: 'center field' }, { key: 'RF', label: 'right field' }
  ];
  for (const base of bases) {
    for (const outs of [0, 1]) {
      for (const of of OF) {
        const distractors = shuffle(BASE_NAMES.filter(b => b !== base.dest)).slice(0, 3);
        items.push(makeItem({
          level: 2, category: 'defense', outs,
          runners: { first:false, second: base.key==='second', third: base.key==='third' },
          hit: { type: 'fly', pos: of.key, label: 'Deep fly, tagging' },
          prompt: `Runner on ${base.label}, ${OUTS_DESC[outs]}. A deep fly to ${of.label} is caught and the runner tags up. Where does the outfielder's throw need to go to have a chance?`,
          correctText: base.dest, distractors,
          explanation: `The throw has to beat the tagging runner to the base he's advancing to — ${base.dest}.`
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
      "Runners on 1st and 2nd, less than 2 outs. Batter hits a routine popup in fair territory, catchable by an infielder with ordinary effort. What's the call?",
      "Less than 2 outs, runners on 1st and 2nd. The batter skies a routine popup over the infield in fair ground. What happens?"
    ],
    correctText: "Infield Fly Rule — batter is automatically out, whether caught or not",
    distractors: ["No special rule — it's a normal fly ball", "Automatic double play", "Ground rule double"],
    explanation: "Infield Fly Rule applies with runners on 1st & 2nd (or bases loaded) and fewer than 2 outs on a catchable fair popup — it protects the runners from a cheap double play."
  },
  {
    level: 3, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'SS', label:'Infield popup' },
    prompts: [
      "Bases loaded, 1 out. The batter pops it up in fair territory, an easy catch for the shortstop. What's the call?",
      "1 out, bases loaded. Routine infield popup in fair ground. What's the ruling?"
    ],
    correctText: "Infield Fly Rule — batter is automatically out, whether caught or not",
    distractors: ["No special rule applies here", "It's a force play only", "Ground rule double"],
    explanation: "Bases loaded with fewer than 2 outs is also an Infield Fly Rule situation — same protection for the runners."
  },
  {
    level: 3, category: 'offense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'2B', label:'Infield popup (fly called)' },
    prompts: [
      "Infield Fly Rule has been called on a popup with runners on 1st and 2nd. What should the runners do?",
      "Umpire signals Infield Fly on a popup, runners on 1st and 2nd. What's the right move for both runners?"
    ],
    correctText: "Hold near their bases — the batter's already out, so tag up if you want to advance on the catch",
    distractors: ["Sprint to the next base immediately", "Both run home", "Ignore the play"],
    explanation: "Since the batter is out regardless, runners aren't forced — advance only at their own risk, tagging up if it's caught."
  },
  {
    level: 4, category: 'defense', outs: 1, runners: { first:true, second:false, third:true },
    hit: null,
    prompts: [
      "1st and 3rd, 1 out. The runner on 1st breaks for 2nd to draw a throw. The catcher sees the runner on 3rd inching down the line. What should the catcher do?",
      "Runners on 1st and 3rd, 1 out. 1st tries to steal 2nd, but 3rd is drifting off the bag. What's the catcher's read?"
    ],
    correctText: "Look the runner on 3rd back, and only throw to 2nd if he isn't a threat to score",
    distractors: ["Always throw through to 2nd no matter what", "Throw to 3rd base immediately", "Do nothing and concede 2nd base"],
    explanation: "Classic 1st-and-3rd defensive read — never give up a run just to get the trail runner."
  },
  {
    level: 4, category: 'defense', outs: 0, runners: { first:false, second:true, third:false },
    hit: { type:'ground', pos:'CF', label:'Single to CF' },
    prompts: [
      "Runner on 2nd, no outs. Single to center field — the runner rounds 3rd and heads home. Who does the center fielder throw to?",
      "No outs, runner on 2nd scores on a single to center. Where should the outfielder's throw go first?"
    ],
    correctText: "The cutoff man lined up between CF and home, who decides whether to let it go through or hold it",
    distractors: ["Directly to the catcher, skip the cutoff", "2nd base", "1st base"],
    explanation: "Throws to the plate go through a cutoff so the defense can react if a trail runner is also moving, or cut a throw that has no chance."
  },
  {
    level: 4, category: 'defense', outs: 0, runners: { first:true, second:false, third:true },
    hit: { type:'ground', pos:'RF', label:'Single to RF' },
    prompts: [
      "Runners on 1st and 3rd, no outs. Single to right field scores the runner from 3rd; the runner from 1st rounds 2nd. What's the cutoff man's read?",
      "No outs, 1st and 3rd. A single to right scores the run and the trail runner takes 2nd. What should the cutoff man do?"
    ],
    correctText: "Line up with the throw home; if the run is unstoppable, cut it and go after the trail runner advancing",
    distractors: ["Stand at 2nd base only", "Stand in the outfield grass", "Stand directly behind home plate"],
    explanation: "A smart cutoff man cuts an unstoppable throw home and redirects it to get the extra out elsewhere."
  },
  {
    level: 3, category: 'offense', outs: 0, runners: { first:false, second:true, third:false },
    hit: { type:'bunt', pos:'3B', label:'Sac bunt' },
    prompts: [
      "Runner on 2nd, no outs. Your coach calls for a sacrifice bunt. What's the goal?",
      "No outs, runner on 2nd. The bunt sign is on. Why?"
    ],
    correctText: "Give yourself up to move the runner to 3rd, in scoring position for a sac fly",
    distractors: ["Bunt for a base hit only, ignore the runner", "Try to steal 3rd instead", "Take the pitch"],
    explanation: "A sac bunt trades an out to advance the runner into better scoring position."
  },
  {
    level: 3, category: 'defense', outs: 0, runners: { first:true, second:false, third:false },
    hit: { type:'line', pos:'SS', label:'Line drive (caught)' },
    prompts: [
      "Runner on 1st, 0 outs. Line drive is snared by the shortstop. What's the best play right after the catch?",
      "0 outs, runner on 1st takes off as a liner is smoked to short — and caught. What's next?"
    ],
    correctText: "Check 1st base — double off the runner if he broke for 2nd",
    distractors: ["Throw home", "Nothing else needed, one out is enough", "Throw to 3rd"],
    explanation: "Runners often break early on a hard-hit ball — if he's off the bag, it's an easy double play back to 1st."
  },
  {
    level: 3, category: 'offense', outs: 1, runners: { first:true, second:false, third:false },
    hit: { type:'line', pos:'SS', label:'Line drive (caught)' },
    prompts: [
      "Runner on 1st, 1 out. A hard line drive is caught by the shortstop. What should you do?",
      "1 out, you're leading off 1st. A sharp liner gets speared by the shortstop. What now?"
    ],
    correctText: "Get back to 1st immediately to avoid the double play",
    distractors: ["Keep running to 2nd", "Stop halfway and watch", "Run to 3rd"],
    explanation: "You must retouch 1st before the ball beats you back, or you'll be doubled off."
  },
  {
    level: 4, category: 'offense', outs: 0, runners: { first:true, second:false, third:false },
    hit: null,
    prompts: [
      "Runner on 1st, 0 outs. The batter crushes a deep fly ball toward the gap that's likely extra bases. What should the runner on 1st do at first crack of the bat?",
      "0 outs, you're on 1st. Batter smokes one to the gap — could be a hit, could be caught. What's your first move?"
    ],
    correctText: "Go back partway to read it, then take off hard once it's clear it won't be caught (\"read and go\")",
    distractors: ["Sprint to 2nd immediately, assuming it's a hit", "Freeze on 1st until the ball lands", "Tag up even though it's a gap shot"],
    explanation: "With fewer than 2 outs, runners always read a deep fly before committing full speed, in case it's caught."
  },
  {
    level: 4, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'CF', label:'Medium fly' },
    prompts: [
      "Bases loaded, 1 out. Medium fly ball to the outfield is caught. The runner from 3rd tags and goes. What's the defense's best play?",
      "1 out, bases loaded. A medium-depth fly is caught and 3rd tags home. What should the defense do?"
    ],
    correctText: "Throw home through the cutoff man to try to get the runner tagging from 3rd",
    distractors: ["Throw to 1st base", "Throw to 2nd base", "Hold the ball — no play is possible"],
    explanation: "A tagging runner from 3rd on a medium fly is often beatable with a strong, accurate relay home."
  },
  {
    level: 4, category: 'defense', outs: 0, runners: { first:false, second:true, third:false },
    hit: { type:'bunt', pos:'3B', label:'Bunt' },
    prompts: [
      "Runner on 2nd, no outs. Batter squares to bunt down the third-base line. Where's the play?",
      "No outs, runner on 2nd, batter drops a bunt toward third. What's the defense's move?"
    ],
    correctText: "Field it and throw to 1st — no force at 3rd since the runner started there and 1st is open",
    distractors: ["Automatically throw to 3rd for the lead runner", "Throw home", "Ignore the bunt"],
    explanation: "The runner on 2nd isn't forced (1st is empty), so the standard play is the sure out at first."
  },
  {
    level: 3, category: 'offense', outs: 1, runners: { first:true, second:false, third:false },
    hit: { type:'bunt', pos:'1B', label:'Sac bunt' },
    prompts: [
      "Runner on 1st, 1 out. Batter lays down a sacrifice bunt. What must the runner on 1st do?",
      "1 out, you're on 1st. Your teammate squares around and bunts. What are you required to do?"
    ],
    correctText: "Advance to 2nd — he's forced to vacate 1st for the batter-runner",
    distractors: ["Stay on 1st", "Run to 3rd immediately", "Head back to the dugout"],
    explanation: "The batter becoming a runner forces everyone ahead of him on the bases to move up."
  },
  {
    level: 5, category: 'defense', outs: 0, runners: { first:true, second:true, third:false },
    hit: { type:'fly', pos:'3B', label:'Popup near foul line' },
    prompts: [
      "Runners on 1st and 2nd, no outs. A popup drifts near the foul line and the umpire has already declared Infield Fly. The 3rd baseman lets it drop untouched. What happens?",
      "Infield Fly is already called on a popup drifting toward the line, runners on 1st and 2nd. The fielder lets it fall untouched. What's the result?"
    ],
    correctText: "If it lands fair, the batter is still out (the call already happened) — but if it rolls foul, it's just a foul ball",
    distractors: ["It's an automatic double play", "The batter is safe with no outs recorded", "It counts as a base hit"],
    explanation: "Infield Fly is declared regardless of catch — but the ball can still go foul, which negates the rule and is simply a foul ball."
  },
  {
    level: 5, category: 'offense', outs: 1, runners: { first:false, second:true, third:true },
    hit: { type:'ground', pos:'3B', label:'Sharp ground ball' },
    prompts: [
      "Runners on 2nd and 3rd, 1 out (1st base open, no force at home). Sharp ground ball to a deep-playing third baseman. What should the runner on 3rd do?",
      "1 out, runners on 2nd and 3rd, 1st base open. A hard grounder is fielded deep by the third baseman. What's 3rd's read?"
    ],
    correctText: "Read it — go only if the throw home clearly can't beat him, since there's no force protecting him",
    distractors: ["Always run home no matter what", "Always stay no matter what", "Run to the dugout"],
    explanation: "With no force at home, the runner on 3rd must judge the fielder's position and arm before committing — a bad read costs an out with no force to hide behind."
  },
  {
    level: 5, category: 'defense', outs: 1, runners: { first:true, second:true, third:false },
    hit: { type:'line', pos:'1B', label:'Line drive (caught)' },
    prompts: [
      "Runners on 1st and 2nd, 1 out. Line drive is caught by the first baseman and both runners had broken early. What's the smartest defensive play?",
      "1 out, 1st and 2nd both running on a line drive that's caught by the first baseman. What's the defense's best sequence?"
    ],
    correctText: "Step on 1st for the second out, then relay to 2nd for a possible triple play",
    distractors: ["Throw home", "Just take the one out, nothing more to do", "Throw to 3rd only"],
    explanation: "A line drive with both runners going can turn into a triple play: catch, step on 1st, relay to 2nd."
  },
  {
    level: 5, category: 'offense', outs: 0, runners: { first:false, second:false, third:true },
    hit: { type:'bunt', pos:'H', label:'Suicide squeeze' },
    prompts: [
      "Runner on 3rd, 0 outs, suicide squeeze is on — the runner breaks for home as the pitch is released. What must the batter do?",
      "0 outs, 3rd base, suicide squeeze called. The runner is already sprinting home on the pitch. What's the batter's job?"
    ],
    correctText: "Bunt the ball no matter what, even a bad pitch, to protect the runner",
    distractors: ["Take the pitch to see if it's a strike", "Swing away for a hit", "Bunt only if it's a strike"],
    explanation: "The runner is fully committed on a suicide squeeze — the batter must put the bat on the ball regardless of location."
  },
  {
    level: 5, category: 'defense', outs: 2, runners: { first:true, second:false, third:true },
    hit: { type:'ground', pos:'2B', label:'Ground ball' },
    prompts: [
      "Runners on 1st and 3rd, 2 outs. Ground ball to the second baseman. Where's the play, and does the run from 3rd count if it's a force out?",
      "2 outs, 1st and 3rd. A grounder is hit to second. If the defense gets the force, does the run from 3rd still count?"
    ],
    correctText: "Throw to 1st for the force — since it's the 3rd out on a force play, the run from 3rd does NOT count even if he crosses home first",
    distractors: ["Throw home — must stop the run directly", "Throw to 3rd base", "It doesn't matter, the run always counts"],
    explanation: "A force out that ends the inning wipes out any run scored on the same play, even if the runner touched home a split second earlier."
  },
  {
    level: 5, category: 'offense', outs: 2, runners: { first:true, second:false, third:true },
    hit: { type:'ground', pos:'2B', label:'Ground ball' },
    prompts: [
      "Runners on 1st and 3rd, 2 outs. You hit a routine ground ball to the second baseman. If you're forced out at 1st, does the run from 3rd count?",
      "2 outs, 1st and 3rd, you ground out on a force at 1st. Does the run that crossed from 3rd count?"
    ],
    correctText: "No — the 3rd out is a force at 1st, so the run does not count no matter when 3rd's runner crosses the plate",
    distractors: ["Yes, the run always counts if he crosses before the throw arrives", "Yes, but only if he crosses before the ball is fielded", "It's up to the umpire's judgment"],
    explanation: "Force-out rule: if the 3rd out of the inning is a force play, no run can score on that play, period."
  },
  {
    level: 5, category: 'defense', outs: 1, runners: { first:true, second:true, third:true },
    hit: { type:'fly', pos:'RF', label:'Deep fly' },
    prompts: [
      "Bases loaded, 1 out. Deep fly ball to right field is caught. Every runner tags up. Where does the defense's throw go?",
      "1 out, bases loaded, deep fly to right is caught and all three tag. Where should the throw go?"
    ],
    correctText: "Home, through the cutoff man — the run is the priority, even if the trail runners also advance",
    distractors: ["2nd base, to stop the runner from 1st", "1st base", "Nowhere — let everyone advance"],
    explanation: "Preventing the run always outranks getting a trailing runner advancing to 2nd or 3rd."
  },
  {
    level: 4, category: 'offense', outs: 0, runners: { first:true, second:false, third:false },
    hit: null,
    prompts: [
      "Runner on 1st, 0 outs, and you've got a big secondary lead. The pitcher spins and throws behind you to 1st (a pick-off attempt). What should you do?",
      "0 outs, 1st base, big secondary lead taken. Pitcher wheels and throws over to pick you off. What's your reaction?"
    ],
    correctText: "Get back to the base immediately in a straight, safe path — don't get caught in a rundown",
    distractors: ["Try to steal 2nd anyway", "Freeze and hope the throw misses", "Run toward the pitcher"],
    explanation: "Getting picked off or caught in a rundown kills an inning — get back safely first, take chances later."
  },
  {
    level: 2, category: 'offense', outs: 0, runners: { first:false, second:false, third:false },
    hit: null,
    prompts: [
      "You're the runner rounding 3rd base and your coach is giving you a stop sign. What should you do?",
      "Rounding third, the base coach puts both hands up (stop sign). What's your move?"
    ],
    correctText: "Stop at 3rd — the coach has a better view of the outfielder and the ball than you do",
    distractors: ["Ignore it and run home anyway", "Slow down but keep going", "Turn around and go back to 2nd"],
    explanation: "The third base coach can see the outfielder's arm and positioning that the runner can't — always trust the stop sign."
  },
  {
    level: 2, category: 'defense', outs: 0, runners: { first:false, second:false, third:true },
    hit: { type:'ground', pos:'1B', label:'Comebacker' },
    prompts: [
      "Runner on 3rd only, no outs. Slow roller fielded by the pitcher. What's the play?",
      "No outs, runner on 3rd. A comebacker is fielded by the pitcher. Where's the safe out?"
    ],
    correctText: "1st base — no force at 3rd, so take the sure out at first",
    distractors: ["Home plate — force out", "3rd base — tag the runner", "2nd base"],
    explanation: "With only 1st and 2nd open, the runner on 3rd isn't forced — go get the routine out at first."
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
  ...buildSpecialItems()
];
