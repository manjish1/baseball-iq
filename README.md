# ⚾ Baseball IQ Challenge — Peewee Edition

A timed, multiple-choice quiz that trains real baseball situational IQ — offense and defense — using a live diagram of the diamond (runners + outs) for every question. Rules and answers are adjusted specifically for Peewee-level play (NGBSA Peewee division), not standard/MLB baseball.

**Play it here:** https://manjish1.github.io/baseball-iq/

## Peewee rules baked in

This league plays differently from regular baseball, and the questions reflect that:
- **No stealing or leading off** — a runner's foot can't leave the base until the ball is hit.
- **No bunting.**
- **No Infield Fly Rule.**
- Defense answers favor the realistic **easy out** over the textbook "best" out (e.g. force plays always go to 2nd, not a harder throw to a lead runner), and "hold onto the ball" is the right call on long infield throws with no force in play.
- Includes this league's own quirks too: mandatory sliding at 2nd/3rd/home, no headfirst slides advancing, and the "freezing the runner" exception.

## How it works

- Every question shows a diamond diagram with the current runners and outs, plus a marker for where the ball is hit.
- **Defense** questions ask "where's the play at?" — testing force-play logic, cutoff assignments, and backing up a base.
- **Offense** questions ask "what should the runner do?" — testing tag-up rules and running-on-contact situations.
- **Timer Mode** is off by default (untimed, always full points) — flip it on for the 15-second beat-the-clock mode, where points decay linearly with time.
- Correct answers build a **streak**, which multiplies your points (up to 3x).
- The question pool grows harder as you rack up correct answers — starting with single-runner basics (Rookie) and ending with Hall-of-Fame-level rule nuances.
- Hundreds of question phrasings are generated from a shared, verified rules engine (not a fixed script), so you learn the underlying read instead of memorizing which letter is correct.
- A **History** tab logs every question you've answered — your answer, the correct answer, and the explanation — so you can review what to study.

## Running locally

No build step — it's static HTML/CSS/JS.

```bash
cd baseball-iq
python3 -m http.server 8080
# open http://localhost:8080
```
