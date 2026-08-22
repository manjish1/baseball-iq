# ⚾ Baseball IQ Challenge

A timed, multiple-choice quiz that trains real baseball situational IQ — offense and defense — using a live diagram of the diamond (runners + outs) for every question.

**Play it here:** https://manjish1.github.io/baseball-iq/

## How it works

- Every question shows a diamond diagram with the current runners and outs, plus a marker for where the ball is hit.
- **Defense** questions ask "where's the play?" — testing force-play logic (who's forced, who isn't, and where the lead out is).
- **Offense** questions ask "what should the runner do?" — testing tag-up rules, fly-ball depth reads, and running-on-contact situations.
- You have **15 seconds** per question. Points decay linearly with time: answer instantly for 100% of the points, answer right at the buzzer for close to 0%.
- Correct answers build a **streak**, which multiplies your points (up to 3x).
- The question pool grows harder as you rack up correct answers — starting with single-runner basics (Rookie) and ending with infield-fly-rule and force-out-negates-run edge cases (Hall of Fame).
- Hundreds of question phrasings are generated from a shared, verified rules engine (not a fixed script), so you learn the underlying read instead of memorizing which letter is correct.
- A **History** tab logs every question you've answered — your answer, the correct answer, and the explanation — so you can review what to study.

## Running locally

No build step — it's static HTML/CSS/JS.

```bash
cd baseball-iq
python3 -m http.server 8080
# open http://localhost:8080
```
