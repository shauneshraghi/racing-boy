# Racing Boy

A browser kart racer in plain HTML, CSS and JavaScript, with no build step. A kid walks a garage plaza (upgrades, paint shop, car lot, track signpost) and races five rivals on hand-made tracks seen from a chase camera, in a pixel-art HD-2D look drawn entirely in code.

**Play:** https://shauneshraghi.github.io/racing-boy/ (GitHub Pages, deployed from `main`).

**Install on iPhone:** open the link in Safari, tap Share, then Add to Home Screen. The app keeps its own save, separate from Safari's: to bring a Safari game in, open ☰ Menu → Copy code in Safari, then paste it under ☰ Menu (or the splash's "Bring a game from another device") in the app. The same code or a saved file moves a game between any two devices.

## Requirements

| What | Needed for | Version |
|---|---|---|
| A modern browser | playing (WebGL2 for the HD-2D look; `?hd=0` without it) | any current Chrome, Firefox, Safari |
| Node.js | tests, drift lab, dev server, screenshots | 20 or newer |
| `playwright-core` + a Chrome/Chromium | headless screenshots only (`npm run shot`) | pinned in `package.json` |

The game has no runtime dependencies. `npm install` fetches only `playwright-core`, and only screenshots use it.

## Setup

```sh
bash scripts/bootstrap.sh        # checks Node, runs npm install, finds or fetches a Chrome
bash scripts/bootstrap.sh --no-browser   # Node check only
```

## Commands

```sh
npm test                 # node --test tests/*.test.mjs (about 40 s; prints race times and bot win rates)
npm run serve            # http://localhost:8766/
npm run shot             # headless screenshot to output/shot.png
npm run shot -- "nosplash=1&fresh=1" --size 390x844 --out output/plaza.png
npm run drift-lab -- --world 2 --up 2    # drift handling lab (see .claude/skills/drift-tune)
```

Useful URL flags: `?dev=1` (lots of coins, every track open, no saving), `?fresh=1`, `?nosplash=1`, `?race=<trackId>`, `?car=<carId>`, `?seed=N`, `?hd=0`.

## Developing in Claude Code on the web

The repo is set up for cloud sessions at claude.ai/code:

- `.claude/settings.json` runs `.claude/hooks/session-start.sh` on session start. The script does nothing locally. In a cloud VM (`CLAUDE_CODE_REMOTE=true`) it runs `scripts/bootstrap.sh`.
- The cloud image ships Node 22 and Chrome for Testing (`$CHROME_PATH`), and `npm run shot` uses that Chrome, so the default **Limited** network access (package managers allowed) is enough. Playwright's own browser CDN is not on that allowlist. The bootstrap only falls back to it on machines without Chrome.
- A cloud session cannot open a browser for you. Check visual changes there with `npm run shot`; the agent can read the PNG. To play a change, merge it to `main` and open the Pages link (about a minute to deploy; bump the `?v=N` stamps in `index.html`).
- Agent guidance lives in `AGENTS.md` (`CLAUDE.md` points to it), and the design is in `.scratch/spec.md`.

## Layout

`index.html` loads `js/logic.js` (game rules, tested), `post.js` (WebGL2 post-process), `sprites.js` (pixel art), `render.js`, `audio.js` (synth music and effects) and `ui.js`. Tests are in `tests/`, and dev tooling is in `scripts/`. `AGENTS.md` has the details.
