# terminal-platformer

Minimalist terminal-aesthetic platformer for the browser. WASD + wall jumps.
Infinite seeded levels, rotating archetypes, bugs, fire, and legacy code.

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
| `R` | retry from checkpoint |
| `M` | mute / unmute sound |
| `Enter` | next level |

Wall-jump recipe: jump to a wall, hold toward it to slide, press `W` + lean away, steer back, repeat. Towers, twin slots, and pit-walls all require it.

**Sound:** tiny WebAudio synth, no files — wall-jumps rise in pitch as you chain them, plus jump/stomp/coin/checkpoint/death/exit blips. Starts on first input (browser autoplay rules). `M` mutes.

**Stomping:** land ON a bug to squash it (+1 shard, bounce). Touch its side and you die.

## Level archetypes (rotate every level)

`generateLevel(n)` in `game.js` is seeded by level number (`mulberry32`), so every level is generated and reproducible. Archetype = `TRAVERSE → SPIRE → GAUNTLET → …`:

- **TRAVERSE** — horizontal run: towers, twin wall-slots, pit-walls. Exit at ground level or on a final mini-climb.
- **SPIRE** — vertical: chained wall-slots zigzag upward, safe floor below (falls cost progress, not lives). Exit at the top. Checkpoint halfway.
- **GAUNTLET** — hazard-dense run with a checkpoint mid-way and an elevated exit.

Difficulty scales with level: walls grow, slots tighten, pits widen, bugs get faster, fire cycles get shorter.

## Enemies & hazards

| Thing | Looks like | Rule |
|-------|------------|------|
| `bug` walker | red `><` patrolling a ledge | stomp it or die |
| drone | red `<>` sine-wave flyer | stomp it or die |
| fire jet | wall/floor `[^]` vent | `!` warns 0.7s, then deadly burst — time it |
| fire patch | orange `^^^` on ground | deadly, jump over |
| segfault spikes | red `▲▲▲` | deadly, jump over |
| legacy sludge | amber `~~~` pool | slows move + weakens jump while inside |
| `[ckpt]` | cyan box | checkpoint — respawns move here |

Falling into `/dev/null` respawns (and costs a death). Dying resets bugs and crumbling ledges for a fresh attempt.

Tuning lives in the `T` object at the top of `game.js` (gravity, jump velocity, wall-slide cap, coyote time, jump buffer).
