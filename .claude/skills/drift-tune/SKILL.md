---
name: drift-tune
description: Playtest and tune Racing Boy's drift handling with a bot that drifts every bend of the world-1 tracks. Use when drifting feels too twitchy, too loose, turns too hard or too little, can't hold a line through a bend, or after changing drift, hop or steering constants, grip, track shapes or car stats.
---

# Drift tune

The drift's feel is numbers in the tuning block at the top of `js/logic.js` (`DRIFT_TURN`, `DRIFT_WIDE`, `HOP_STEER`, `HOP_T`, `DRIFT_SLIDE`, `DRIFT_CHARGE_WIDE`, `DRIFT_TIERS`, `DRIFT_BOOST`) read against the bends the tracks actually have. Tune against the lab, not by feel alone: the lab shows *why* a drift misbehaves.

## Steps

1. **Baseline.** From the repo root run `node .claude/skills/drift-tune/drift-lab.mjs`. Done when you can name the failing column for the complaint (see Reading the lab).
2. **Sweep.** Try candidate values without editing files: `--set DRIFT_TURN=0.45,DRIFT_WIDE=0.06` (any `var` in the tuning block; arrays like `DRIFT_TIERS=[0.6,1.3,2.1]` work). Grep the sweep to `lap clean|yaw at|^ALL`. Done when a candidate meets every target below for `pip`.
3. **Every starter car.** Rerun the chosen values with `--car` for `pip rumble hopper comet clover`. Low-grip fast cars (`comet`) run tighter on the wide side; note it rather than tune it away (it is the car's "a bit slippery" identity) unless it hits walls on most bends.
4. **Commit the numbers, test first.** Move the drift-arc bounds in `tests/logic.test.mjs` ("a stock-car drift arc fits the world-1 bends") to the new target and watch it go red, then edit the tuning block. Run `node --test tests/*.test.mjs`: the world-1 race-time and win checks must still pass. Bump every `?v=N` in `index.html`.
5. **Hand it to the player.** Serve (`python3 -m http.server 8766 --bind 127.0.0.1`) and give the user `http://localhost:8766/?race=meadow&dev=1&fresh=1&nosplash=1`. Feel is the user's call; ask which bend felt wrong and feed that bend's row back into step 2.

## Reading the lab

Per track it prints a clean (no-drift) and a drifting lap time, the drift's yaw envelope at top speed (stick fully against / neutral / fully into, as rad/s and turn radius in cells), and one row per bend (runs of curvature tighter than radius 40 that turn at least 35°):

- `need` is the yaw a bend asks for at top speed (mean curvature × speed). `fit` places it in the envelope; `TOO TIGHT` means even full counter-steer turns harder than the bend, so the car is driven into the inside wall.
- `stick` is the bot's mean stick relative to the drift (+1 into, −1 against); `against`/`into` are the shares of drift time pinned at full lock. Pinned against = the drift turns too hard; pinned into = too wide.
- `max|d|/hw` over 1 means it left the road; `off s` and `wall` (steps near the wall) say how badly.
- The `ALL` line totals it.

Targets for world 1, stock car:

- no `TOO TIGHT` and no `too wide` bends; `wall` 0
- `ALL` mean stick between −0.4 and +0.2, pinned against under 25%, pinned into under 10% (some pinning at bend shoulders is normal: the bot drifts from just before the bend starts)
- drifting lap a little faster than clean on every track (the boost pays for the drift), by seconds, not tens of seconds

## Gotchas

- The bot is ideal: it inverts the drift turn model and steers by pure pursuit. A lab pass means the drift *can* follow the bends; a human still needs margin, so prefer neutral slightly wider than the typical bend.
- Steering during the hop turns the car at `HOP_STEER` × grip. At full grip a 0.22 s hop turns ~30° before the drift starts, which no counter-steer can undo (a drift always turns its own way). Check this first when drifts dive inward.
- The drift yaw scales with `grip`, so Tires upgrades tighten every drift (+4.5% per level).
- If the bot gets stuck in a wall the lap time balloons and `off s` counts the whole stall; read the first bad bend, not the totals.
