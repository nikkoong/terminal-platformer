# terminal-platformer

Minimalist terminal-aesthetic platformer for the browser. WASD + wall jumps.
Infinite seeded levels, six rotating archetypes, bugs, fire, and legacy code.
Pause anytime with `P` (or `Esc`) — even mid-jump.

## Run

Open `index.html` in any browser (double-click, or `python3 -m http.server` then visit `http://localhost:8000`):

```bash
cd projects/terminal-platformer
python3 -m http.server 8000
# → http://localhost:8000
```

No build step, no dependencies. Best level persists in `localStorage`.

## Controls

| Key | Action |
|-----|--------|
| `A` / `D` | move left / right (arrows also work) |
| `W` | jump · wall-jump · confirm (Space/↑ also work) |
| `S` | slam / fast-fall (↓ also works) |
| `P` / `Esc` | pause / resume — any time, any state |
| `R` | retry from checkpoint |
| `M` | mute / unmute sound |
| `Enter` | next level |

Pausing freezes the world exactly as-is (mid-air, mid-slam, mid-death-wish) and the game
auto-pauses when the window or tab loses focus, so you never come back to a dead cursor.

Wall-jump recipe: jump to a wall, hold toward it to slide, press `W` + lean away, steer back, repeat. Towers, twin slots, and pit-walls all require it.

**Sound:** tiny WebAudio synth, no files — wall-jumps rise in pitch as you chain them, plus jump/stomp/coin/checkpoint/death/exit blips. Starts on first input (browser autoplay rules). `M` mutes.

**Stomping:** land ON a bug to squash it (+1 shard, bounce). Touch its side and you die.

## Level archetypes (rotate every level)

`generateLevel(n)` in `game.js` is seeded by level number (`mulberry32`), so every level is generated and reproducible. Archetype = `TRAVERSE → SPIRE → GAUNTLET → CAVERN → SKYLINE → SINKHOLE → …`, and each archetype tints the grid, watermark, footer, and HUD line with its own terminal color:

- **TRAVERSE** — horizontal run: towers, twin wall-slots, pit-walls, crumbling stones. Exit at ground level or on a final mini-climb.
- **SPIRE** — vertical: chained wall-slots zigzag upward, safe floor below (falls cost progress, not lives). Exit at the top. Checkpoint halfway.
- **GAUNTLET** — hazard-dense run with a checkpoint mid-way and an elevated exit.
- **CAVERN** — rock ceiling overhead: low crawl tunnels (run, don't jump), boulder mesas, hanging icicle fields with shards in the gaps. No pits — the ceiling is the hazard.
- **SKYLINE** — floating islands over the void: crumbling islands, spring pads (bounce to sky shards), moving lifts bridging wide gaps, flyers in the air. One bad leap is `/dev/null`.
- **SINKHOLE** — a vented well: drop and wall-slide ledge to ledge, dodging timed vents, into a spiked basin. Exit is DOWN. Checkpoint halfway.

Difficulty scales with level: walls grow, slots tighten, pits widen, bugs get faster, fire cycles get shorter, gaps widen.

## Enemies & hazards

| Thing | Looks like | Rule |
|-------|------------|------|
| `bug` walker | red `><` patrolling a ledge | stomp it or die |
| drone | red `<>` sine-wave flyer | stomp it or die |
| fire jet | wall/floor `[^]` or ceiling `[v]` vent | `!` warns 0.7s, then deadly burst — time it |
| fire patch | orange `^^^` on ground | deadly, jump over |
| segfault spikes | red `▲▲▲` | deadly, jump over |
| icicles | red `▼` columns hanging from cavern rock | deadly, don't jump into them |
| legacy sludge | amber `~~~` pool | slows move + weakens jump while inside |
| crumbling ledge | amber `! !` | shakes 0.5s after you land, vanishes, respawns |
| spring pad | cyan `^^` | launches you sky-high — some shards only a spring can reach |
| lift | violet `↕` pad | bobs up and down; ride it across wide gaps |
| `[ckpt]` | cyan box | checkpoint — respawns move here |

Falling into `/dev/null` respawns (and costs a death). Dying resets bugs and crumbling ledges for a fresh attempt.

Tuning lives in the `T` object at the top of `game.js` (gravity, jump velocity, spring boost, wall-slide cap, coyote time, jump buffer).
