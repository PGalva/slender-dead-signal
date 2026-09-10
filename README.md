# Slender: Dead Signal — Phase 2

A 2D survival-horror browser game. You operate a night-vision surveillance camera
and push through **three back-to-back sectors** — the Dark Pine Forest, the
Abandoned Shack, and the Forgotten Monolith — recovering journal pages from a 5×5
grid while a faceless Entity hunts you. Each sector is a new environment, a new
map, and a faster hunt, stitched together with seamless glitch transitions.

**Pure HTML5 + CSS3 + Vanilla JavaScript. No frameworks, no libraries, no build step.**

## Play

Open `index.html` in any modern browser. Nothing to install.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## The three sectors

| Sector | Environment | Pages | Threat |
|---|---|---|---|
| 1 | The Dark Pine Forest | 2 | Tutorial pace — the Entity often loses your trail. |
| 2 | The Abandoned Shack | 3 | Faster hunt, quicker battery drain. |
| 3 | The Forgotten Monolith | 3 | Extreme speed, high static, fast drain — relentless. |

Clear a sector's page target and the next begins instantly (a 2-second glitch
transition, no reload). Battery carries between sectors with a +22% recharge at
each new one, and the Entity grows more aggressive the further you get.

## Controls

| Action | Keyboard | Touch / Mouse |
|---|---|---|
| Move North / South / West / East | `W A S D` or arrow keys | On-screen D-pad |
| Pause / Resume | `P` or `Esc` | ⏸ Button |
| Retry Sector / Restart | `R` | ↻ Retry Sector button |

## Key mechanics

- **Battery** drops per move (no background timer — the pace is yours); packs restore +20%.
- **Static** rises near the Entity and drives the heartbeat tempo; at 100% it's game over.
- Each move, the Entity steps **toward you**; the alert names its **bearing** (NORTH, SOUTH-EAST…) so evasion is a decision, not luck.
- If it corners you it **blinks** away and reappears at distance.
- **Retry Sector** — die and you restart only the sector you fell in, instantly, keeping your momentum.
- Turn **Sound** on for a heartbeat that races as the threat rises.

## Structure

```
index.html        markup and the 3 views (Home / Game / How to Play)
css/style.css     design tokens, dynamic scene theming, HUD, grid, D-pad
js/game.js        state, missions, Entity AI, environments, audio, input
```

## Accessibility

- No state relies on colour alone: every alert carries a text prefix
  (`[OK]`, `[WARNING]`, `[ALERT]`, `[CONTACT]`) and an icon; HUD bars use distinct stripes.
- Visible `:focus-visible` outline on everything focusable.
- `role="grid"`/`gridcell` with per-cell `aria-label`; `role="status"` + `aria-live`
  on the status line, radar and log. Skip link and `prefers-reduced-motion` respected.

## Deploy to GitHub Pages

Settings → Pages → Branch `main`, folder `/ (root)`. Live at
`https://<user>.github.io/<repo>/`.

## License

MIT
