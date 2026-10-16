/* terminal-platformer — minimalist WASD wall-jump platformer
 * Controls: A/D move · W jump / wall-jump · S slam · R retry · M mute · Enter next
 * Stomp bugs by landing on them. Infinite seeded levels, rotating archetypes:
 * TRAVERSE (horizontal) · SPIRE (vertical, exit is UP) · GAUNTLET (hazard run).
 * No dependencies. Open index.html in a browser.
 */
(() => {
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const BASE_Y = 460;

// ---- tuning ----
const T = {
  speed: 335,
  accelGround: 3400,
  accelAir: 2400,
  gravity: 2500,
  maxFall: 950,
  wallSlideMax: 175,
  jumpV: 880,
  wallJumpX: 530,
  wallJumpY: 830,
  slamV: 950,
  coyote: 0.10,
  buffer: 0.12,
  wallCoyote: 0.10,
  warnT: 0.7, // fire-jet telegraph duration
};
const PW = 22, PH = 28;
const ARCHES = ["TRAVERSE", "SPIRE", "GAUNTLET"];
const archOf = (n) => ARCHES[(n - 1) % ARCHES.length];

// ---- state ----
let level = 1, deaths = 0, shards = 0, levelTime = 0, best = +(localStorage.getItem("tp-best") || 0);
let platforms = [], coins = [], enemies = [], jets = [], hazards = [], sludge = [], checkpoints = [];
let exitRect = null, spawn = { x: 60, y: 300 }, spawnLevel = { x: 60, y: 300 };
let worldW = 3000, killY = 660, minTop = 0, minX = 0;
let camX = 0, camY = 0;
let mode = "intro"; // intro | play | done
let player = null;
let wallLogCd = 0, sludgeLogCd = 0;

const hudLevel = document.getElementById("hud-level");
const hudStats = document.getElementById("hud-stats");
const logEl = document.getElementById("log");
const overlay = document.getElementById("overlay");
const overlayBody = document.getElementById("overlay-body");
const overlayTitle = document.getElementById("overlay-title");

// ---- utils ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function log(msg, cls = "") {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = msg;
  logEl.appendChild(div);
  while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function shrink(r, m) {
  return { x: r.x + m, y: r.y + m, w: r.w - m * 2, h: r.h - m * 2 };
}

// ---- SFX: tiny WebAudio synth, no assets. M toggles mute. ----
const SFX = (() => {
  let ac = null, muted = false, combo = 0, comboT = 0;
  function ctx() {
    if (muted || typeof window === "undefined") return null;
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      return ac;
    } catch { return null; } // headless / unsupported: stay silent
  }
  function blip(freq, dur, type, vol, slide, delay) {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.04, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  return {
    toggleMute() {
      muted = !muted;
      log(muted ? "[SYS] sound off (M to re-enable)" : "[SYS] sound on", "dim");
    },
    jump() { combo = 0; blip(300, 0.12, "square", 0.03, 200); },
    wallJump() {
      const now = performance.now();
      if (now - comboT > 900) combo = 0; // combo window: chained wall-jumps rise in pitch
      comboT = now; combo = Math.min(combo + 1, 8);
      blip(350 + combo * 90, 0.14, "square", 0.045, 150);
    },
    stomp() { blip(500, 0.1, "sawtooth", 0.05, -350); },
    coin() { blip(880, 0.09, "sine", 0.04, 440); },
    death() { blip(220, 0.3, "sawtooth", 0.05, -180); },
    checkpoint() { blip(520, 0.12, "triangle", 0.05, 260); },
    exit() { blip(523, 0.1, "square", 0.04, 0); blip(659, 0.1, "square", 0.04, 0, 0.09); blip(784, 0.16, "square", 0.04, 0, 0.18); },
  };
})();

// ---- construction helpers ----
function solid(x, y, w, h, kind) {
  const s = { x, y, w, h, kind: kind || "ground", state: "solid", t: 0 };
  platforms.push(s);
  minTop = Math.min(minTop, y);
  minX = Math.min(minX, x);
  return s;
}
function coin(x, y) { coins.push({ x, y, taken: false }); }
function walker(x0, x1, topY, speed, rng) {
  enemies.push({ kind: "walker", x: (x0 + x1) / 2 - 12, y: topY - 20, w: 24, h: 20,
    x0, x1, dir: rng() < 0.5 ? -1 : 1, speed, dead: false, phase: rng() * 6 });
}
function flyer(ax, ay, range, speed, rng) {
  enemies.push({ kind: "flyer", ax, ay, range, speed, x: ax, y: ay, w: 24, h: 18,
    dead: false, phase: rng() * 6, t: 0 });
}
function fireJet(x, y, w, h, dir, period, burstT, phase) {
  jets.push({ x, y, w, h, dir, period, burstT, t: phase || 0 });
}
function firePatch(x, topY, w) { hazards.push({ x, y: topY - 14, w, h: 14, kind: "fire" }); }
function spikeStrip(x, topY, w) { hazards.push({ x, y: topY - 16, w, h: 16, kind: "spikes" }); }
function sludgePool(x, topY, w) { sludge.push({ x, y: topY - 10, w, h: 10 }); }
function addCheckpoint(x, topY) { checkpoints.push({ x, y: topY - 46, w: 36, h: 46, used: false }); }
function jetCycle(n) {
  return { period: Math.max(1.7, 2.9 - n * 0.08), burst: Math.min(1.1, 0.7 + n * 0.03) };
}

// ---- TRAVERSE + GAUNTLET cells (horizontal, proven tower pattern) ----
function towerCell(curX, rng, n, danger) {
  const towerH = Math.min(230 + rng() * 110 + n * 14, 430);
  const towerW = 36, runW = 230;
  solid(curX, BASE_Y, runW, 140, "ground");
  const tx = curX + runW;
  const topY = BASE_Y;
  decorateRun(curX + 40, runW - 80, topY, rng, n, danger);
  solid(tx - 8, BASE_Y, towerW + 16, 140, "ground");
  solid(tx, BASE_Y - towerH, towerW, towerH, "wall");
  solid(tx - 112, BASE_Y - 130, 72, 16, "step");
  const lx = tx + towerW + 46, ly = BASE_Y - towerH + 24;
  solid(lx, ly, 140, 18, "step");
  if (danger > 0.4 && n >= 3 && rng() < 0.45) {
    // timed flame guarding the landing gap
    const c = jetCycle(n);
    fireJet(tx + towerW, ly - 44, 46, 44, "down", c.period, c.burst, rng() * c.period);
  }
  coin(tx - 112 + 30, BASE_Y - 170);
  coin(tx + towerW / 2, BASE_Y - towerH - 30);
  return lx + 140 + 95;
}
function twinCell(curX, rng, n, danger) {
  const slotGap = Math.max(102, 132 - n * 1.5 - rng() * 8);
  const wallH = Math.min(280 + rng() * 110 + n * 15, 520);
  const wallW = 30, runW = 230;
  solid(curX, BASE_Y, runW, 140, "ground");
  const lx = curX + runW;
  decorateRun(curX + 40, runW - 80, BASE_Y, rng, n, danger);
  solid(lx - 8, BASE_Y, wallW * 2 + slotGap + 16, 140, "ground");
  solid(lx, BASE_Y - wallH, wallW, wallH, "wall");
  solid(lx + wallW + slotGap, BASE_Y - wallH, wallW, wallH, "wall");
  solid(lx - 112, BASE_Y - 130, 72, 16, "step");
  if (danger > 0.5 && n >= 4 && rng() < 0.5) {
    // floor vent inside the slot: climb during the idle window
    const c = jetCycle(n);
    fireJet(lx + wallW, BASE_Y - 80, slotGap, 80, "up", c.period + 0.4, 0.8, rng() * 2);
  }
  const rx = lx + wallW * 2 + slotGap + 46, ry = BASE_Y - wallH + 24;
  solid(rx, ry, 140, 18, "step");
  coin(lx + wallW + slotGap / 2, BASE_Y - wallH / 2);
  coin(rx + 60, ry - 30);
  return rx + 140 + 95;
}
function gapCell(curX, rng, n, danger) {
  const runW = 200;
  const pitW = Math.min(80 + rng() * 50 + n * 4, 170);
  solid(curX, BASE_Y, runW, 140, "ground");
  decorateRun(curX + 30, runW - 60, BASE_Y, rng, n, danger * 0.6);
  const tx = curX + runW + pitW;
  const towerH = Math.min(220 + rng() * 100 + n * 14, 420);
  const towerW = 36;
  solid(tx - 8, BASE_Y, towerW + 16, 140, "ground");
  solid(tx, BASE_Y - towerH, towerW, towerH, "wall");
  solid(tx - 112, BASE_Y - 130, 72, 16, "step");
  const lx = tx + towerW + 46, ly = BASE_Y - towerH + 24;
  solid(lx, ly, 140, 18, "step");
  coin(curX + runW + pitW / 2, BASE_Y - 60);
  return lx + 140 + 95;
}
// one hazard per run-up: keeps every jump readable, never overlapping
function decorateRun(x, w, topY, rng, n, danger) {
  if (w < 90 || rng() > danger) return;
  const r = rng();
  const maxW = 1 + Math.min(4, (n / 2) | 0);
  if (r < 0.34 && enemies.length < maxW) {
    walker(x + 10, x + w - 34, topY, 55 + Math.min(85, n * 9) + rng() * 20, rng);
    log(`[SYS] wild bug appeared (stomp it!)`, "warn");
  } else if (r < 0.48) {
    spikeStrip(x + w / 2 - 25, topY, 40 + rng() * 30); // "segfault" — jump it
  } else if (r < 0.62) {
    sludgePool(x + w / 2 - 45, topY, 70 + rng() * 40); // "legacy code" — slows you
  } else if (r < 0.72 && n >= 2) {
    firePatch(x + w / 2 - 30, topY, 50 + rng() * 25);
  }
}

// ---- SPIRE (vertical: chained slots climbing up, exit at top) ----
function spireSegment(ex, yR, dir, rng, n, danger, hasJet) {
  const gap = Math.max(104, 126 - n);
  let segH = 240 + rng() * 60;
  if (hasJet) segH = Math.min(segH, 260);
  const wallW = 30, floorW = wallW * 2 + gap;
  let LW, RW, R1;
  if (dir > 0) {
    solid(ex, yR, floorW, 18, "step"); // slot floor, level with rest ledge
    LW = solid(ex, yR - segH, wallW, segH, "wall");
    RW = solid(ex + wallW + gap, yR - segH, wallW, segH, "wall");
    R1 = solid(ex + floorW + 40, yR - segH, 200, 18, "step"); // next rest ledge
  } else {
    solid(ex - floorW, yR, floorW, 18, "step");
    RW = solid(ex - wallW, yR - segH, wallW, segH, "wall");
    LW = solid(ex - wallW - gap - wallW, yR - segH, wallW, segH, "wall");
    R1 = solid(ex - floorW - 40 - 200, yR - segH, 200, 18, "step");
  }
  const slotCx = (LW.x + RW.x + wallW) / 2;
  coin(slotCx, yR - segH / 2);
  coin(R1.x + 100, yR - segH - 30);
  if (hasJet) {
    const c = jetCycle(n);
    fireJet(LW.x + wallW, yR - 80, gap, 80, "up", c.period + 0.4, 0.8, rng() * 2);
  } else if (danger > 0.4 && rng() < 0.4) {
    flyer(slotCx, yR - segH / 2 - 40, 55 + rng() * 30, 1.2 + Math.min(1.2, n * 0.1), rng);
  }
  const r = rng();
  if (r < danger * 0.5 && enemies.length < 1 + Math.min(4, (n / 2) | 0)) {
    R1.w = 230;
    walker(R1.x + 8, R1.x + R1.w - 32, yR - segH, 50 + Math.min(80, n * 8) + rng() * 15, rng);
  } else if (r < danger * 0.7) {
    sludgePool(R1.x + 40, yR - segH, 90);
  }
  return { x: dir > 0 ? R1.x + R1.w : R1.x, y: yR - segH };
}
function genSpire(n, rng) {
  const danger = Math.min(1, 0.35 + n * 0.07);
  worldW = 1500;
  solid(-300, BASE_Y, 2100, 140, "ground"); // safe floor: falls cost progress, not lives
  spawnLevel = { x: 60, y: BASE_Y - 60 };
  const stages = Math.min(4 + ((n / 2) | 0), 8);
  let ex = 420, yR = BASE_Y, dir = 1;
  const jetStages = new Set();
  if (n >= 4) { jetStages.add(1 + ((rng() * (stages - 1)) | 0)); }
  for (let i = 0; i < stages; i++) {
    const last = i === stages - 1;
    const out = spireSegment(ex, yR, dir, rng, n, last ? 0 : danger, jetStages.has(i));
    ex = out.x; yR = out.y;
    if (i === ((stages / 2) | 0) - 1) addCheckpoint(dir > 0 ? ex - 230 : ex + 30, yR);
    if (!last) dir = -dir;
  }
  // exit plaza on the final rest ledge
  const topX = dir > 0 ? ex - 200 : ex - 60;
  solid(topX - 60, yR, 320, 18, "step");
  exitRect = { x: topX + 60, y: yR - 84, w: 52, h: 84 };
  worldW = 1500;
  killY = BASE_Y + 200;
}

// ---- level assembly ----
function genTraverse(n, rng, gauntlet) {
  const danger = gauntlet ? 1 : Math.min(0.85, 0.25 + n * 0.06);
  solid(0, BASE_Y, 380, 140, "ground");
  spawnLevel = { x: 60, y: BASE_Y - 60 };
  let curX = 380;
  const cells = gauntlet ? 4 : Math.min(3 + (((n - 1) * 0.6) | 0), 9);
  for (let i = 0; i < cells; i++) {
    const r = rng();
    let type = "tower";
    if (i > 0 || gauntlet) type = r < 0.42 ? "tower" : r < 0.74 ? "twin" : "gap";
    if (i === 1 && gauntlet) addCheckpoint(curX + 60, BASE_Y);
    curX = type === "twin" ? twinCell(curX, rng, n, danger)
         : type === "gap" ? gapCell(curX, rng, n, danger)
         : towerCell(curX, rng, n, danger);
  }
  solid(curX, BASE_Y, 300, 140, "ground");
  if (!gauntlet && rng() < 0.5) {
    exitRect = { x: curX + 140, y: BASE_Y - 84, w: 52, h: 84 }; // ground exit
  } else {
    // elevated exit: final mini-climb
    const exx = curX + 120;
    solid(exx - 100, BASE_Y - 130, 72, 16, "step");
    solid(exx, BASE_Y - 170, 150, 18, "step");
    exitRect = { x: exx + 45, y: BASE_Y - 254, w: 52, h: 84 };
    decorateRun(curX + 20, 120, BASE_Y, rng, n, danger);
  }
  worldW = curX + 300 + 200;
  killY = BASE_Y + 200;
}
function generateLevel(n) {
  if (n === undefined) n = level; else level = n;
  platforms = []; coins = []; enemies = []; jets = []; hazards = []; sludge = []; checkpoints = [];
  exitRect = null; minTop = BASE_Y; minX = 0;
  const rng = mulberry32(((n * 2654435761) >>> 0) || 1);
  const arch = archOf(n);
  if (arch === "SPIRE") genSpire(n, rng);
  else genTraverse(n, rng, arch === "GAUNTLET");
  spawn = { x: spawnLevel.x, y: spawnLevel.y };
}
function resetPlayer() {
  player = {
    x: spawn.x, y: spawn.y, w: PW, h: PH,
    vx: 0, vy: 0, ground: false, inSludge: false,
    touchL: false, touchR: false,
    coyote: 0, buffer: 0, wallDir: 0, wallCoyote: 0,
    face: 1,
  };
  camX = clamp(player.x - W / 2, 0, Math.max(0, worldW - W));
  camY = 0;
}
function resetHazards() {
  for (const e of enemies) e.dead = false;
  for (const s of platforms) { s.state = "solid"; s.t = 0; }
}

// ---- input (WASD primary) ----
const keys = new Set();
const ALIAS = { arrowleft: "a", arrowright: "d", arrowup: "w", arrowdown: "s", " ": "w" };
addEventListener("keydown", (e) => {
  const k = (ALIAS[e.key.toLowerCase()] || e.key.toLowerCase());
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (k === "w") {
    if (mode !== "play") { advance(); return; }
    player.buffer = T.buffer;
  }
  if (k === "r" && mode === "play") { respawn("manual retry"); }
  if (k === "m") { SFX.toggleMute(); }
  if (k === "enter" && mode !== "play") advance();
});
addEventListener("keyup", (e) => {
  const k = (ALIAS[e.key.toLowerCase()] || e.key.toLowerCase());
  keys.delete(k);
  if (k === "w" && player && player.vy < -320) player.vy = -320; // variable jump height
});
function advance() {
  if (mode === "intro") { mode = "play"; overlay.classList.add("hidden"); log(`[OK] level_${pad(level)} started — reach ./exit.sh`, "ok"); }
  else if (mode === "done") { level++; startLevel(false); }
}
const pad = (n) => String(n).padStart(3, "0");

// ---- flow ----
function startLevel(firstIntro) {
  generateLevel(level);
  resetPlayer();
  levelTime = 0;
  const arch = archOf(level);
  hudLevel.textContent = `> level_${pad(level)}.sys [${arch}]`;
  if (firstIntro) {
    mode = "intro";
    overlayTitle.textContent = "$ ./run_level.sh --help";
    overlayBody.textContent =
      ` walls are climbable. trust the jump.\n\n A/D — move    W — jump / wall-jump\n S — slam down    R — retry    M — mute\n\n land ON bugs to squash them. touch fire,\n spikes, or a bug's side and you die.\n green ~~~ sludge~ is legacy code: slow.\n\n levels rotate: TRAVERSE · SPIRE (up!) ·\n GAUNTLET. infinite. seeded. no mercy.`;
    overlay.classList.remove("hidden");
    log(`[SYS] terminal-platformer v2.0 loaded`, "dim");
    log(`[SYS] bugs, fire & legacy code detected`, "warn");
  } else {
    mode = "play";
    overlay.classList.add("hidden");
    log(`[OK] level_${pad(level)} [${arch}] generated (seed=${level})`, "ok");
    if (arch === "SPIRE") log(`[SYS] exit is UP. checkpoint halfway.`, "warn");
    if (arch === "GAUNTLET") log(`[SYS] maximum danger. checkpoint mid-run.`, "warn");
  }
  updateHud();
}
function respawn(why) {
  resetPlayer();
  resetHazards();
  if (why !== "manual retry") { deaths++; SFX.death(); log(`[ERR] ${why} — respawn (deaths: ${deaths})`, "err"); }
  else log(`[WARN] retry — back to checkpoint`, "warn");
  updateHud();
}
function updateHud() {
  const alive = enemies.filter((e) => !e.dead).length;
  hudStats.textContent = `deaths: ${deaths} | time: ${levelTime.toFixed(1)}s | shards: ${shards} | bugs: ${alive}` +
    (best ? ` | best: level_${pad(best)}` : "");
}

// ---- physics ----
function livePlatforms() {
  return platforms.filter((s) => s.state !== "gone");
}
function collideAxis(p, axis) {
  const solids = livePlatforms();
  if (axis === "x") {
    p.touchL = p.touchR = false;
    for (const s of solids) {
      if (rectsOverlap(p, s)) {
        if (p.vx > 0) { p.x = s.x - p.w; p.touchR = true; }
        else if (p.vx < 0) { p.x = s.x + s.w; p.touchL = true; }
        p.vx = 0;
      }
    }
  } else {
    p.ground = false;
    for (const s of solids) {
      if (rectsOverlap(p, s)) {
        if (p.vy > 0) {
          p.y = s.y - p.h; p.vy = 0; p.ground = true;
          if (s.kind === "crumble" && s.state === "solid") { s.state = "shaking"; s.t = 0.55; }
        }
        else if (p.vy < 0) { p.y = s.y + s.h; p.vy = 0; }
      }
    }
  }
}
function update(dt) {
  levelTime += dt;
  wallLogCd -= dt; sludgeLogCd -= dt;
  const p = player;
  const L = keys.has("a"), R = keys.has("d"), S = keys.has("s");
  const want = (R ? 1 : 0) - (L ? 1 : 0);
  if (want !== 0) p.face = want;

  const slow = p.inSludge;
  const maxSp = T.speed * (slow ? 0.55 : 1);
  const acc = (p.ground ? T.accelGround : T.accelAir) * (slow ? 0.5 : 1);
  if (want !== 0) p.vx = clamp(p.vx + want * acc * dt, -maxSp, maxSp);
  else {
    const f = (p.ground ? 2600 : 400) * dt;
    p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
  }

  p.vy += T.gravity * (slow ? 1.1 : 1) * dt;
  if (S && !p.ground) p.vy = Math.max(p.vy, T.slamV);

  // horizontal + wall touch
  p.x += p.vx * dt;
  p.x = clamp(p.x, 0, worldW - p.w);
  collideAxis(p, "x");
  const touchingWall = (p.touchL || p.touchR) && !p.ground;
  if (touchingWall) { p.wallDir = p.touchR ? 1 : -1; p.wallCoyote = T.wallCoyote; }
  else p.wallCoyote -= dt;

  // wall slide friction
  const pressingIn = (p.touchL && L) || (p.touchR && R) || want === 0;
  if (touchingWall && p.vy > T.wallSlideMax && pressingIn) p.vy = T.wallSlideMax;
  p.vy = Math.min(p.vy, T.maxFall);

  // jumping (buffered + coyote + wall)
  const jumpV = T.jumpV * (slow ? 0.82 : 1);
  p.coyote = p.ground ? T.coyote : p.coyote - dt;
  p.buffer -= dt;
  if (p.buffer > 0) {
    if (p.ground || p.coyote > 0) {
      p.vy = -jumpV; p.ground = false; p.coyote = 0; p.buffer = 0;
      SFX.jump();
    } else if (touchingWall || p.wallCoyote > 0) {
      const dir = p.touchR ? -1 : p.touchL ? 1 : -p.wallDir;
      p.vx = dir * T.wallJumpX;
      p.vy = -T.wallJumpY;
      p.face = dir;
      p.buffer = 0; p.wallCoyote = 0;
      SFX.wallJump();
      if (wallLogCd <= 0) { log(`[OK] wall-jump :: vx=${dir * T.wallJumpX}`, "dim"); wallLogCd = 0.9; }
    }
  }

  p.y += p.vy * dt;
  collideAxis(p, "y");

  // sludge: legacy code slows you while inside
  const wasSludge = p.inSludge;
  p.inSludge = sludge.some((z) => rectsOverlap(p, z));
  if (p.inSludge && !wasSludge && sludgeLogCd <= 0) {
    log(`[WARN] legacy code… velocity throttled`, "warn"); sludgeLogCd = 2;
  }

  // enemies: patrol; stomp kills, side contact kills you
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.kind === "walker") {
      e.x += e.dir * e.speed * dt;
      if (e.x <= e.x0) { e.x = e.x0; e.dir = 1; }
      if (e.x + e.w >= e.x1) { e.x = e.x1 - e.w; e.dir = -1; }
    } else {
      e.t += dt;
      e.x = e.ax + Math.sin(e.t * e.speed + e.phase) * e.range;
      e.y = e.ay + Math.sin(e.t * 1.7 + e.phase) * 22;
    }
    if (rectsOverlap(p, e)) {
      const stomp = p.vy > 100 && (p.y + p.h) - e.y < 16;
      if (stomp) {
        e.dead = true; p.vy = -620; shards++;
        SFX.stomp();
        log(`[OK] bug squashed (stomp +1 shard)`, "ok");
      } else {
        respawn(e.kind === "walker" ? "segfault: touched a bug" : "segfault: drone collision");
        return;
      }
    }
  }

  // fire jets: telegraphed cycle, deadly only while bursting
  for (const j of jets) {
    j.t += dt;
    const cyc = j.t % j.period;
    j.bursting = cyc > j.period - j.burstT;
    j.warning = !j.bursting && cyc > j.period - j.burstT - T.warnT;
    if (j.bursting && rectsOverlap(p, shrink(j, 4))) {
      respawn("burned: stood in the fire");
      return;
    }
  }

  // static hazards
  for (const hz of hazards) {
    if (rectsOverlap(p, shrink(hz, 5))) {
      respawn(hz.kind === "fire" ? "burned: fire patch" : "segfault: spikes");
      return;
    }
  }

  // crumbling ledges
  for (const s of platforms) {
    if (s.kind !== "crumble" || s.state === "solid") continue;
    s.t -= dt;
    if (s.state === "shaking" && s.t <= 0) { s.state = "gone"; s.t = 2.2; }
    else if (s.state === "gone" && s.t <= 0) { s.state = "solid"; s.t = 0; }
  }

  // checkpoints
  for (const c of checkpoints) {
    if (!c.used && rectsOverlap(p, c)) {
      c.used = true;
      spawn = { x: c.x, y: c.y - 40 };
      SFX.checkpoint();
      log(`[OK] checkpoint saved`, "ok");
    }
  }

  // shards
  for (const c of coins) {
    if (!c.taken && rectsOverlap({ x: p.x - 6, y: p.y - 6, w: p.w + 12, h: p.h + 12 }, { x: c.x - 8, y: c.y - 8, w: 16, h: 16 })) {
      c.taken = true; shards++;
      SFX.coin();
      log(`[OK] shard collected (+1)`, "ok");
    }
  }
  if (p.y > killY) { respawn("fell into /dev/null"); return; }
  if (exitRect && rectsOverlap(p, exitRect)) completeLevel();

  // camera
  camX = clamp(p.x + p.w / 2 - W / 2, 0, Math.max(0, worldW - W));
  const targetY = clamp(p.y + p.h / 2 - H * 0.55, minTop - 160, 0);
  camY += (targetY - camY) * Math.min(1, dt * 6);

  if ((levelTime * 10 | 0) % 10 === 0) updateHud();
}
function completeLevel() {
  mode = "done";
  best = Math.max(best, level);
  localStorage.setItem("tp-best", best);
  SFX.exit();
  overlayTitle.textContent = `$ ./exit.sh — level_${pad(level)} [${archOf(level)}] cleared ✓`;
  overlayBody.textContent =
    ` time: ${levelTime.toFixed(1)}s   deaths: ${deaths}   shards: ${shards}\n` +
    ` next: level_${pad(level + 1)}.sys [${archOf(level + 1)}] :: difficulty rising`;
  overlay.classList.remove("hidden");
  log(`[OK] level_${pad(level)} cleared in ${levelTime.toFixed(1)}s`, "ok");
  updateHud();
}

// ---- render: terminal aesthetic ----
function draw() {
  ctx.fillStyle = "#020402";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-Math.round(camX), -Math.round(camY));

  // faint grid
  ctx.strokeStyle = "rgba(51,255,102,0.07)";
  ctx.lineWidth = 1;
  const gx0 = Math.floor(camX / 40) * 40, gy0 = Math.floor(camY / 40) * 40;
  ctx.beginPath();
  for (let x = gx0; x < camX + W; x += 40) { ctx.moveTo(x, camY); ctx.lineTo(x, camY + H); }
  for (let y = gy0; y < camY + H; y += 40) { ctx.moveTo(camX, y); ctx.lineTo(camX + W, y); }
  ctx.stroke();

  // watermark
  ctx.fillStyle = "rgba(51,255,102,0.06)";
  ctx.font = "bold 120px monospace";
  ctx.fillText(`level_${pad(level)}`, camX + 40, camY + 200);

  // platforms
  for (const s of platforms) {
    if (s.state === "gone") continue;
    if (s.x + s.w < camX - 20 || s.x > camX + W + 20) continue;
    const jx = s.state === "shaking" ? (Math.random() < 0.5 ? -2 : 2) : 0;
    ctx.fillStyle = s.kind === "step" ? "#061206" : s.kind === "crumble" ? "#0d0d04" : "#041004";
    ctx.fillRect(s.x + jx, s.y, s.w, s.h);
    ctx.strokeStyle = s.kind === "crumble" ? "#ffbf00" : "#33ff66";
    ctx.lineWidth = s.kind === "step" ? 1.5 : 2;
    ctx.strokeRect(s.x + jx + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    ctx.fillStyle = "#9dffb5";
    ctx.fillRect(s.x + jx, s.y, s.w, 2);
    if (s.kind === "wall") {
      ctx.fillStyle = "rgba(51,255,102,0.5)";
      for (let y = s.y + 18; y < s.y + s.h - 8; y += 34) {
        ctx.fillRect(s.x + 4, y, 3, 3);
        ctx.fillRect(s.x + s.w - 7, y, 3, 3);
      }
    }
    if (s.kind === "crumble") {
      ctx.fillStyle = "#ffbf00"; // cracks
      ctx.font = "12px monospace";
      ctx.fillText("! !", s.x + s.w / 2 - 10, s.y + 14);
    }
  }

  // sludge: legacy code
  ctx.font = "13px monospace";
  for (const z of sludge) {
    ctx.fillStyle = "rgba(181,137,0,0.28)";
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.fillStyle = "#b58900";
    ctx.fillText("~".repeat(Math.max(3, (z.w / 10) | 0)), z.x + 4, z.y + 9);
  }

  // static hazards
  for (const hz of hazards) {
    if (hz.kind === "fire") {
      ctx.fillStyle = "#ff7722";
      ctx.font = "bold 15px monospace";
      ctx.fillText("^".repeat(Math.max(2, (hz.w / 11) | 0)), hz.x + 2, hz.y + 13);
    } else {
      ctx.fillStyle = "#ff4444";
      ctx.font = "bold 14px monospace";
      ctx.fillText("▲".repeat(Math.max(2, (hz.w / 12) | 0)), hz.x + 2, hz.y + 14);
    }
  }

  // spawn + checkpoints
  const t = performance.now() / 1000;
  ctx.fillStyle = "#1d7a35";
  ctx.font = "13px monospace";
  ctx.fillText("~/spawn", spawnLevel.x - 10, spawnLevel.y - 12);
  ctx.fillStyle = "#22d3ee";
  for (const c of checkpoints) {
    ctx.strokeStyle = c.used ? "#1d7a35" : "#22d3ee";
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = c.used ? "#1d7a35" : "#22d3ee";
    ctx.font = "9px monospace";
    ctx.fillText(c.used ? "saved" : "[ckpt]", c.x + 2, c.y + 16);
  }

  // shards
  for (const c of coins) {
    if (c.taken) continue;
    const b = Math.sin(t * 4 + c.x) * 3;
    ctx.fillStyle = "#ffbf00";
    ctx.shadowColor = "#ffbf00"; ctx.shadowBlur = 12;
    ctx.font = "bold 20px monospace";
    ctx.fillText("*", c.x - 6, c.y + 7 + b);
    ctx.shadowBlur = 0;
  }

  // enemies
  for (const e of enemies) {
    if (e.dead) continue;
    const wig = Math.sin(t * 10 + e.phase) * 2;
    ctx.fillStyle = "#ff4444";
    ctx.shadowColor = "#ff4444"; ctx.shadowBlur = 10;
    ctx.font = e.kind === "walker" ? "bold 19px monospace" : "bold 17px monospace";
    ctx.fillText(e.kind === "walker" ? "><" : "<>", e.x + 1, e.y + 17 + wig);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffaaaa";
    ctx.font = "9px monospace";
    ctx.fillText("bug", e.x + 3, e.y - 3);
  }

  // fire jets: vent + telegraph + flame
  for (const j of jets) {
    ctx.fillStyle = "#555";
    ctx.font = "12px monospace";
    const vx = j.dir === "right" ? j.x - 16 : j.dir === "left" ? j.x + j.w + 2 : j.x + j.w / 2 - 8;
    const vy = j.dir === "down" ? j.y - 4 : j.dir === "up" ? j.y + j.h + 12 : j.y + 12;
    ctx.fillText("[^]", vx, vy);
    if (j.warning) {
      ctx.fillStyle = (t * 6 | 0) % 2 ? "#ffbf00" : "#553300";
      ctx.font = "bold 16px monospace";
      ctx.fillText("!", j.x + j.w / 2 - 3, j.y - 4);
    }
    if (j.bursting) {
      const fl = 0.7 + 0.3 * Math.sin(t * 40 + j.x);
      ctx.fillStyle = `rgba(255,${100 + (fl * 60) | 0},34,0.9)`;
      ctx.font = "bold 18px monospace";
      const rows = Math.max(1, (j.h / 18) | 0);
      for (let rI = 0; rI < rows; rI++) {
        ctx.fillText("^".repeat(Math.max(1, (j.w / 12) | 0)), j.x + 2, j.y + 16 + rI * 18);
      }
    }
  }

  // exit door
  if (exitRect) {
    const e = exitRect;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = "#062b0e";
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.strokeStyle = "#33ff66"; ctx.lineWidth = 2;
    ctx.shadowColor = "#33ff66"; ctx.shadowBlur = 10 + pulse * 14;
    ctx.strokeRect(e.x, e.y, e.w, e.h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#33ff66";
    ctx.font = "bold 13px monospace";
    ctx.fillText("EXIT", e.x + 8, e.y + 30);
    ctx.fillStyle = "#9dffb5";
    ctx.font = "10px monospace";
    ctx.fillText("./exit", e.x + 5, e.y + 48);
    ctx.fillText(".sh", e.x + 12, e.y + 60);
  }

  // player: block cursor (amber tint while sludged)
  const p = player;
  const blink = (t % 0.9) < 0.55;
  ctx.fillStyle = p.inSludge ? "#b58900" : "#33ff66";
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 16;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#021202";
  ctx.fillRect(p.x + 4, p.y + 6, 5, 5);
  ctx.fillRect(p.x + p.w - 9, p.y + 6, 5, 5);
  if (blink && p.ground && Math.abs(p.vx) < 5) {
    ctx.fillStyle = "#33ff66";
    ctx.fillRect(p.x + p.w + 5, p.y + p.h - 6, 10, 4);
  }
  ctx.restore();

  // prompt footer
  ctx.fillStyle = "rgba(51,255,102,0.85)";
  ctx.font = "12px monospace";
  ctx.fillText(`user@dev:~/level_${pad(level)}$ ${mode === "play" ? "█" : ""}`, 12, H - 12);
}

// ---- main loop ----
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 1 / 30);
  if (mode === "play") update(dt);
  draw();
  requestAnimationFrame(frame);
}

startLevel(true);
requestAnimationFrame(frame);

// test hook (used by node smoke test; harmless in browser)
globalThis.__tpTest = {
  generateLevel, resetPlayer, update, respawn, archOf,
  keys, startLevel, completeLevel,
  get mode() { return mode; }, set mode(m) { mode = m; },
  state: () => ({ platforms, coins, enemies, jets, hazards, sludge, checkpoints,
    exitRect, spawn, spawnLevel, worldW, killY, minTop, player, level }),
  setLevel(n) { level = n; },
};
})();
