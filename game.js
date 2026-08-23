/* Baseball IQ Challenge — game logic */

const LEVEL_META = {
  1: { name: 'Rookie' },
  2: { name: 'Little Leaguer' },
  3: { name: 'All-Star' },
  4: { name: 'Pro' },
  5: { name: 'Hall of Fame' }
};
const LEVEL_THRESHOLDS = [0, 6, 14, 24, 36]; // correct answers needed to REACH levels 1..5
const MAX_TIME = 15; // seconds
const BASE_POINTS = 10;
const HISTORY_KEY = 'baseballiq_history_v1';
const HIGH_SCORE_KEY = 'baseballiq_highscore_v1';
const TIME_MODE_KEY = 'baseballiq_timemode_v1';
const SEEN_KEY = 'baseballiq_seen_v1'; // persists across sessions/devices-in-browser

let state = {
  score: 0,
  streak: 0,
  correctCount: 0,
  totalAnswered: 0,
  level: 1,
  history: loadHistory(),
  highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
  timeMode: localStorage.getItem(TIME_MODE_KEY) === 'true', // off by default
  seenByLevel: loadSeen(),
  current: null,
  questionStart: 0,
  timerHandle: null,
  answered: false
};

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}
function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(-500)));
}

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
  catch { return {}; }
}
function saveSeen() {
  localStorage.setItem(SEEN_KEY, JSON.stringify(state.seenByLevel));
}

function levelForCorrectCount(n) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (n >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

function streakMultiplier(streak) {
  if (streak <= 0) return 1;
  return Math.min(3, 1 + Math.floor((streak - 1) / 3) * 0.5);
}

// Draws from a persisted per-level "deck": every question at a level gets
// shown once before any of them repeat, and that deck survives across page
// reloads and separate sessions (stored in localStorage), not just the
// current tab. Once the whole level has been seen, the deck reshuffles fresh.
function pickQuestion() {
  const levelPool = QUESTION_BANK.filter(q => q.level === state.level);
  const seen = new Set(state.seenByLevel[state.level] || []);
  let unseen = levelPool.filter(q => !seen.has(q.prompt));
  if (unseen.length === 0) {
    seen.clear();
    unseen = levelPool;
  }
  const chosen = unseen[Math.floor(Math.random() * unseen.length)];
  seen.add(chosen.prompt);
  state.seenByLevel[state.level] = [...seen];
  saveSeen();
  return chosen;
}

// ---------------- DOM refs ----------------
const el = {
  scoreVal: document.getElementById('scoreVal'),
  streakVal: document.getElementById('streakVal'),
  multVal: document.getElementById('multVal'),
  highScoreVal: document.getElementById('highScoreVal'),
  field: document.getElementById('field'),
  timerWrap: document.getElementById('timerWrap'),
  timerFill: document.getElementById('timerFill'),
  timeModeToggle: document.getElementById('timeModeToggle'),
  categoryTag: document.getElementById('categoryTag'),
  prompt: document.getElementById('prompt'),
  choices: document.getElementById('choices'),
  feedback: document.getElementById('feedback'),
  nextBtn: document.getElementById('nextBtn'),
  levelBadge: document.getElementById('levelBadge'),
  levelupToast: document.getElementById('levelupToast'),
  tabPlay: document.getElementById('tabPlay'),
  tabHistory: document.getElementById('tabHistory'),
  playView: document.getElementById('playView'),
  historyView: document.getElementById('historyView'),
  historyList: document.getElementById('historyList'),
  historyStats: document.getElementById('historyStats'),
  filterAll: document.getElementById('filterAll'),
  filterCorrect: document.getElementById('filterCorrect'),
  filterWrong: document.getElementById('filterWrong'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn')
};

let historyFilter = 'all';

function updateScoreboard() {
  el.scoreVal.textContent = state.score;
  el.streakVal.textContent = state.streak;
  const mult = streakMultiplier(state.streak);
  el.multVal.textContent = 'x' + mult.toFixed(1);
  el.streakVal.classList.toggle('streak-hot', state.streak >= 3);
  el.highScoreVal.textContent = state.highScore;
  el.levelBadge.textContent = 'Level ' + state.level + ': ' + LEVEL_META[state.level].name;
}

function clearTimer() {
  if (state.timerHandle) { cancelAnimationFrame(state.timerHandle); state.timerHandle = null; }
}

function startTimer() {
  clearTimer();
  state.questionStart = performance.now();
  el.timerWrap.style.display = state.timeMode ? 'block' : 'none';
  if (!state.timeMode) return;
  el.timerFill.style.width = '100%';
  function tick() {
    const elapsed = (performance.now() - state.questionStart) / 1000;
    const pct = Math.max(0, 1 - elapsed / MAX_TIME);
    el.timerFill.style.width = (pct * 100) + '%';
    if (elapsed >= MAX_TIME) {
      handleAnswer(-1, true);
      return;
    }
    state.timerHandle = requestAnimationFrame(tick);
  }
  state.timerHandle = requestAnimationFrame(tick);
}

el.timeModeToggle.checked = state.timeMode;
el.timeModeToggle.addEventListener('change', () => {
  state.timeMode = el.timeModeToggle.checked;
  localStorage.setItem(TIME_MODE_KEY, String(state.timeMode));
  if (!state.answered) startTimer(); // restart timing for the question in progress
});

function showLevelUpToast(lvl) {
  el.levelupToast.textContent = '⬆ Leveled up! Now: ' + LEVEL_META[lvl].name;
  el.levelupToast.classList.add('show');
  setTimeout(() => el.levelupToast.classList.remove('show'), 2200);
}

function renderQuestion() {
  state.answered = false;
  el.feedback.innerHTML = '';
  el.feedback.className = 'feedback';
  el.nextBtn.style.display = 'none';

  const q = pickQuestion();
  state.current = q;

  renderDiamond(el.field, { runners: q.runners, outs: q.outs, hit: q.hit });

  el.categoryTag.textContent = q.category === 'defense' ? 'Defense' : 'Offense';
  el.categoryTag.className = 'category-tag ' + q.category;
  el.prompt.textContent = q.prompt;

  el.choices.innerHTML = '';
  q.choices.forEach((choiceText, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choiceText;
    btn.addEventListener('click', () => handleAnswer(idx, false));
    el.choices.appendChild(btn);
  });

  startTimer();
}

function handleAnswer(chosenIdx, isTimeout) {
  if (state.answered) return;
  state.answered = true;
  clearTimer();
  el.timerFill.style.width = '0%';

  const q = state.current;
  const elapsedSec = Math.min(MAX_TIME, (performance.now() - state.questionStart) / 1000);
  const isCorrect = !isTimeout && chosenIdx === q.correct;

  const buttons = el.choices.querySelectorAll('.choice-btn');
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correct) btn.classList.add('reveal-correct');
    else if (idx === chosenIdx) btn.classList.add('wrong');
  });

  let pointsEarned = 0;
  if (isCorrect) {
    state.streak += 1;
    state.correctCount += 1;
    const timeFactor = state.timeMode ? Math.max(0, (MAX_TIME - elapsedSec) / MAX_TIME) : 1;
    const mult = streakMultiplier(state.streak);
    pointsEarned = Math.round(BASE_POINTS * mult * timeFactor);
    state.score += pointsEarned;
  } else {
    state.streak = 0;
  }
  state.totalAnswered += 1;

  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
  }

  const prevLevel = state.level;
  state.level = levelForCorrectCount(state.correctCount);
  updateScoreboard();
  if (state.level > prevLevel) showLevelUpToast(state.level);

  el.feedback.className = 'feedback ' + (isCorrect ? 'correct-fb' : 'wrong-fb');
  if (isTimeout) {
    el.feedback.innerHTML = `⏱ Time's up! The correct answer was: <strong>${q.choices[q.correct]}</strong><br>${q.explanation}`;
  } else if (isCorrect) {
    el.feedback.innerHTML = `✅ Correct! <span class="points-earned">+${pointsEarned} pts</span> (streak x${streakMultiplier(state.streak).toFixed(1)})<br>${q.explanation}`;
  } else {
    el.feedback.innerHTML = `❌ Not quite. Correct answer: <strong>${q.choices[q.correct]}</strong><br>${q.explanation}`;
  }
  el.nextBtn.style.display = 'block';

  state.history.push({
    ts: Date.now(),
    level: q.level,
    category: q.category,
    prompt: q.prompt,
    chosen: isTimeout ? null : q.choices[chosenIdx],
    correctAnswer: q.choices[q.correct],
    isCorrect,
    isTimeout: !!isTimeout,
    points: pointsEarned,
    elapsedSec: Math.round(elapsedSec * 10) / 10,
    explanation: q.explanation
  });
  saveHistory();
  if (document.getElementById('historyView').classList.contains('visible')) renderHistory();
}

el.nextBtn.addEventListener('click', renderQuestion);

// ---------------- Tabs ----------------
function showTab(tab) {
  const isPlay = tab === 'play';
  el.tabPlay.classList.toggle('active', isPlay);
  el.tabHistory.classList.toggle('active', !isPlay);
  el.playView.classList.toggle('visible', isPlay);
  el.historyView.classList.toggle('visible', !isPlay);
  el.playView.style.display = isPlay ? 'block' : 'none';
  el.historyView.style.display = isPlay ? 'none' : 'block';
  if (!isPlay) renderHistory();
}
el.tabPlay.addEventListener('click', () => showTab('play'));
el.tabHistory.addEventListener('click', () => showTab('history'));

// ---------------- History view ----------------
function setHistoryFilter(f) {
  historyFilter = f;
  el.filterAll.classList.toggle('active', f === 'all');
  el.filterCorrect.classList.toggle('active', f === 'correct');
  el.filterWrong.classList.toggle('active', f === 'wrong');
  renderHistory();
}
el.filterAll.addEventListener('click', () => setHistoryFilter('all'));
el.filterCorrect.addEventListener('click', () => setHistoryFilter('correct'));
el.filterWrong.addEventListener('click', () => setHistoryFilter('wrong'));
el.clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Clear your entire question history? This cannot be undone.')) {
    state.history = [];
    saveHistory();
    renderHistory();
  }
});

function renderHistory() {
  const items = state.history.slice().reverse().filter(h => {
    if (historyFilter === 'correct') return h.isCorrect;
    if (historyFilter === 'wrong') return !h.isCorrect;
    return true;
  });

  const totalCorrect = state.history.filter(h => h.isCorrect).length;
  const total = state.history.length;
  const acc = total ? Math.round((totalCorrect / total) * 100) : 0;
  el.historyStats.innerHTML = `
    <span><strong>${total}</strong> answered</span>
    <span><strong>${totalCorrect}</strong> correct</span>
    <span><strong>${acc}%</strong> accuracy</span>
  `;

  if (!items.length) {
    el.historyList.innerHTML = '<div class="history-empty">No questions here yet. Go play a few rounds!</div>';
    return;
  }

  el.historyList.innerHTML = items.map(h => {
    const date = new Date(h.ts).toLocaleString();
    const yourAns = h.isTimeout ? '(no answer — timed out)' : h.chosen;
    return `
      <div class="history-item ${h.isCorrect ? '' : 'wrong'}">
        <div class="h-top">
          <span>Lvl ${h.level} &middot; ${h.category === 'defense' ? 'Defense' : 'Offense'} &middot; ${h.elapsedSec}s</span>
          <span>${date}</span>
        </div>
        <div class="h-q">${h.prompt}</div>
        <div class="h-a">
          Your answer: <span class="${h.isCorrect ? 'right-ans' : 'wrong-ans'}">${yourAns}</span>
          ${h.isCorrect ? '' : `&nbsp;|&nbsp; Correct: <span class="right-ans">${h.correctAnswer}</span>`}
          &nbsp;|&nbsp; ${h.points} pts
        </div>
        <div class="h-exp">${h.explanation}</div>
      </div>
    `;
  }).join('');
}

// ---------------- Init ----------------
state.level = levelForCorrectCount(state.correctCount);
updateScoreboard();

const splashScreen = document.getElementById('splashScreen');
const gameMain = document.getElementById('gameMain');
const playBallBtn = document.getElementById('playBallBtn');
const appHeader = document.getElementById('appHeader');
const miniHeader = document.getElementById('miniHeader');
const appFooter = document.getElementById('appFooter');
playBallBtn.addEventListener('click', () => {
  splashScreen.style.display = 'none';
  appHeader.style.display = 'none';
  appFooter.style.display = 'none';
  miniHeader.style.display = 'block';
  gameMain.style.display = 'block';
  renderQuestion();
});
