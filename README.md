# Slender: Dead Signal — Phase 3

A fast, escalating 2D survival-horror browser game. You operate a surveillance
camera and sprint through **five back-to-back sectors** of rising threat — from
the Moonlit Pine Woods to the Nightmare Monolith — recovering journal pages from
a 5×5 grid while a faceless Entity hunts you. Each sector is a brighter, distinct
environment, a new map, and a faster hunt, stitched together with seamless glitch
transitions. Die, and retry the sector instantly.

**Pure HTML5 + CSS3 + Vanilla JavaScript. No frameworks, no libraries, no build step.**

## Play

Open `index.html` in any modern browser. Nothing to install.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## The five sectors

| # | Environment | Pages | Battery / move | Threat |
|---|---|---|---|---|
| 1 | Moonlit Pine Woods | 2 | 0.8% | Warmup — slow, it often loses your trail. |
| 2 | The Abandoned Shack | 3 | 1.0% | Escalation — the pulse kicks in. |
| 3 | Desolate Concrete Ruins | 3 | 1.5% | Desperation — aggressive, frequent static bursts. |
| 4 | Flooded Industrial Corridor | 4 | 2.0% | Frenzy — fast, heavy screen shake. |
| 5 | The Nightmare Monolith | 5 | 2.5% | Nightmare — hyper-active, intense distortion. |

17 pages across the whole run. Clear a sector's target and the next launches
instantly (a 1.5s glitch transition, no menu). Battery carries between sectors
with a +40% recharge at each new one, and the Entity grows more aggressive the
deeper you go.

## Controls

| Action | Keyboard | Touch / Mouse |
|---|---|---|
| Move North / South / West / East | `W A S D` or arrow keys | On-screen D-pad |
| Pause / Resume | `P` or `Esc` | ⏸ Button |
| Retry Sector / Restart | `R` | ↻ Retry Sector button |

## Key mechanics

- **Battery** drops per move (no background timer — the pace is yours); packs restore +24%.
- **Static** rises near the Entity and drives the heartbeat tempo; at 100% it's game over.
- Each move, the Entity steps **toward you**; the alert names its **bearing** (NORTH, SOUTH-EAST…) so evasion is a decision, not luck.
- If it corners you it **blinks** away and reappears at distance.
- **Retry Sector** — die and restart only the sector you fell in, instantly, keeping momentum.
- **Escalating audio** — turn Sound on: the heartbeat/pulse races from 52 bpm (Sector 1) to 122+ (Sector 5).

## `changeEnvironment(stageLevel)`

The stage number (1–5) maps to a scene key (`STAGE_ENV`), swapping the inline-SVG
background art, the ambient wash/vignette, the monitor frame glow, and the UI
accent — all self-contained, no external assets.

## Structure

```
index.html        markup and the 3 views (Home / Game / How to Play)
css/style.css     design tokens, per-stage ambient theming, HUD, grid, D-pad
js/game.js        state, 5-sector difficulty ramp, Entity AI, environments, audio, input
```

## Accessibility

- No state relies on colour alone: every alert carries a text prefix
  (`[OK]`, `[WARNING]`, `[ALERT]`, `[CONTACT]`, `[CRITICAL]`) and an icon; HUD bars use distinct stripes.
- Visible `:focus-visible` outline on everything focusable.
- `role="grid"`/`gridcell` with per-cell `aria-label`; `role="status"` + `aria-live`
  on the status line, radar and log. Skip link and `prefers-reduced-motion` respected.

## Deploy to GitHub Pages

Settings → Pages → Branch `main`, folder `/ (root)`. Live at
`https://<user>.github.io/<repo>/`.

## License

MIT
