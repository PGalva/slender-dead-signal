# Slender: Dead Signal

A 2D survival-horror browser game — **Hard Mode**. You operate a night-vision
surveillance camera in a dark forest and must recover **8 journal pages** from a
5×5 grid before the camera static hits 100% or your battery dies. This time the
faceless Entity does not wander — it **hunts you deterministically**, and every
page you collect makes it faster.

**Pure HTML5 + CSS3 + Vanilla JavaScript. No frameworks, no libraries, no build step.**

## Play

Open `index.html` in any modern browser. Nothing to install.

To serve locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Action | Keyboard | Touch / Mouse |
|---|---|---|
| Move North | `W` or `↑` | D-pad ▲ |
| Move South | `S` or `↓` | D-pad ▼ |
| Move West | `A` or `←` | D-pad ◀ |
| Move East | `D` or `→` | D-pad ▶ |
| Pause / Resume | `P` or `Esc` | ⏸ Button |
| Restart | `R` | ↻ New Watch button |

## How it plays

1. Move 1 cell per action. The flashlight reveals nearby cells: **Empty**,
   **Battery (+20%)** or **Page (+1)**.
2. The battery drops **1% per move** — there is no background timer, so the pace
   is yours.
3. After every step you take, the Entity takes 1 step **toward you**. As you
   collect pages, its chance of a **double step** grows.
4. Proximity raises **Static**; distance lowers it. The alert always names the
   Entity's **bearing** (NORTH, SOUTH-EAST, …) so evasion is a decision, not luck.
5. If it stays on top of you too long — or reaches you — it **blinks** away into
   the shadows and reappears at distance.
6. **8 pages = win.** Static at 100% or battery at 0% = game over.

All balance values live in the `CONFIG` object at the top of `js/game.js`.

## Project structure

```
index.html        markup and the 3 views (Home / Game / How to Play)
css/style.css     design tokens, HUD, grid, D-pad, responsiveness
js/game.js        state, core loop, Entity AI, rendering, input
```

## Accessibility

- No state relies on color alone: every alert carries a text prefix
  (`[OK]`, `[WARNING]`, `[ALERT]`, `[CONTACT]`) and an icon, and the HUD bars use
  distinct stripe patterns.
- Visible `:focus-visible` outline on everything focusable.
- `role="grid"` / `role="gridcell"` with per-cell `aria-label`; `role="status"`
  with `aria-live` on the status line, radar and log.
- Skip link and `prefers-reduced-motion` respected.

## Design notes (Hard Mode balancing)

A pure deterministic pursuer on a 5×5 grid is unwinnable on paper — measured at
**0% wins** — because once it is adjacent it mirrors your moves and the static
ratchets to death. Two mechanics keep the mode hard but fair: a **blink** (it
retreats into the shadows after cornering you) and **distance-based recovery**
(static only falls when you break to 2+ cells away). Tuned by simulation to about
a **27% win rate** for a competent player, with losses split between static and
battery — and the escalating double-steps making the final pages the tensest.

## Deploy to GitHub Pages

In **Settings → Pages**, pick the `main` branch and the `/ (root)` folder.
The game will be live at `https://<user>.github.io/<repo>/`.

## License

MIT
