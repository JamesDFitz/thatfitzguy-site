(function () {
  'use strict';

  const STORAGE_KEY = 'mazeRogue.progress.v1';
  const TILE = 28;
  const MAP = [
    '#####################',
    '#P....#.....#.....o.#',
    '#.###.#.###.#.###.#.#',
    '#.....#...#...#.....#',
    '#.#####.#.#.#.#####.#',
    '#.......#...#.......#',
    '###.###.#####.###.###',
    '#...#...#G..#...#...#',
    '#.###.#.#.#.#.###.#.#',
    '#.....#.....#.....#.#',
    '#.###.#####.#####.#.#',
    '#o..#.......#.....#.#',
    '###.#.#####.#.###.###',
    '#...#...G...#...#...#',
    '#.#####.#.#####.###.#',
    '#.......#.....#.....#',
    '#.###.#####.#.###.#.#',
    '#...#...o...#...#...#',
    '#.#####.###.###.###.#',
    '#.....G.....#.......#',
    '#####################'
  ];
  const ROWS = MAP.length;
  const COLS = MAP[0].length;
  const WIDTH = COLS * TILE;
  const HEIGHT = ROWS * TILE;
  const DIRS = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 }
  };
  const DIR_ORDER = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];
  const GHOST_COLORS = [0xff4f6d, 0x62d0ff, 0xffb84a, 0xb46cff];
  const UPGRADES = [
    {
      key: 'speed',
      name: 'Swift Boots',
      description: 'Move faster every run.',
      max: 5,
      cost: (level) => 25 + level * 35
    },
    {
      key: 'lives',
      name: 'Extra Heart',
      description: 'Start each run with another life.',
      max: 3,
      cost: (level) => 45 + level * 60
    },
    {
      key: 'fright',
      name: 'Long Fright',
      description: 'Power pellets scare sentries longer.',
      max: 4,
      cost: (level) => 35 + level * 45
    },
    {
      key: 'phase',
      name: 'Phase Step',
      description: 'Unlock short ghost-proof bursts with Space.',
      max: 3,
      cost: (level) => 60 + level * 70
    },
    {
      key: 'payout',
      name: 'Echo Prism',
      description: 'Earn more permanent Echoes after each run.',
      max: 5,
      cost: (level) => 40 + level * 50
    }
  ];

  const dom = {};
  let meta = loadProgress();
  let run = null;
  let sceneRef = null;
  let phaserGame = null;

  function defaultProgress() {
    return {
      echoes: 0,
      bestScore: 0,
      bestLevel: 1,
      upgrades: { speed: 0, lives: 0, fright: 0, phase: 0, payout: 0 }
    };
  }

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const base = defaultProgress();
      return {
        ...base,
        ...parsed,
        upgrades: { ...base.upgrades, ...(parsed && parsed.upgrades ? parsed.upgrades : {}) }
      };
    } catch (error) {
      return defaultProgress();
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function keyOf(pos) {
    return `${pos.x},${pos.y}`;
  }

  function sameTile(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function opposite(a, b) {
    return a && b && a.x === -b.x && a.y === -b.y;
  }

  function cellAt(x, y) {
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return '#';
    return MAP[y][x];
  }

  function canMove(x, y, dir) {
    const nx = x + dir.x;
    const ny = y + dir.y;
    return cellAt(nx, ny) !== '#';
  }

  function openNeighbors(entity, allowReverse) {
    return DIR_ORDER.filter((dir) => {
      if (!allowReverse && opposite(entity.dir, dir)) return false;
      return canMove(entity.x, entity.y, dir);
    });
  }

  function parseLevel() {
    const pellets = new Set();
    const powers = new Set();
    const ghosts = [];
    let player = { x: 1, y: 1 };

    MAP.forEach((row, y) => {
      [...row].forEach((char, x) => {
        if (char === '.' || char === 'o') pellets.add(keyOf({ x, y }));
        if (char === 'o') powers.add(keyOf({ x, y }));
        if (char === 'P') player = { x, y };
        if (char === 'G') ghosts.push({ x, y });
      });
    });

    return { player, ghosts, pellets, powers };
  }

  function createRun() {
    const nextRun = {
      mode: 'running',
      level: 1,
      score: 0,
      lives: 3 + meta.upgrades.lives,
      earned: 0,
      message: 'Clear the maze, avoid the sentries, and bank Echoes after the run.',
      player: {
        x: 1,
        y: 1,
        dir: { x: 1, y: 0 },
        nextDir: { x: 1, y: 0 },
        moveMs: 0,
        phaseMs: 0,
        invulnMs: 1200,
        phaseCharges: meta.upgrades.phase
      },
      ghosts: [],
      pellets: new Set(),
      powers: new Set(),
      frightMs: 0,
      ghostMs: 0
    };
    loadLevel(nextRun);
    return nextRun;
  }

  function loadLevel(targetRun) {
    const parsed = parseLevel();
    targetRun.player.x = parsed.player.x;
    targetRun.player.y = parsed.player.y;
    targetRun.player.dir = { x: 1, y: 0 };
    targetRun.player.nextDir = { x: 1, y: 0 };
    targetRun.player.moveMs = 0;
    targetRun.player.invulnMs = 1400;
    targetRun.frightMs = 0;
    targetRun.ghostMs = 0;
    targetRun.pellets = parsed.pellets;
    targetRun.powers = parsed.powers;
    targetRun.ghosts = parsed.ghosts.map((pos, index) => ({
      x: pos.x,
      y: pos.y,
      home: { ...pos },
      dir: DIR_ORDER[index % DIR_ORDER.length],
      color: GHOST_COLORS[index % GHOST_COLORS.length],
      eatenMs: 0
    }));
  }

  function setDirection(name) {
    if (!run || !DIRS[name]) return;
    run.player.nextDir = DIRS[name];
  }

  function activatePhase() {
    if (!run || run.mode !== 'running') return;
    if (run.player.phaseCharges <= 0 || run.player.phaseMs > 0) return;
    run.player.phaseCharges -= 1;
    run.player.phaseMs = 1500 + meta.upgrades.phase * 180;
    run.message = 'Phase Step active. Sentries pass through you for a moment.';
    updateHud();
  }

  function playerInterval() {
    return Math.max(76, 142 - meta.upgrades.speed * 11);
  }

  function ghostInterval() {
    const base = Math.max(104, 210 - run.level * 10);
    return run.frightMs > 0 ? base + 82 : base;
  }

  function collectAt(pos) {
    const key = keyOf(pos);
    if (!run.pellets.has(key)) return;
    run.pellets.delete(key);
    const isPower = run.powers.delete(key);
    const value = isPower ? 50 : 10;
    run.score += value;
    run.earned += isPower ? 2 : 1;
    if (isPower) {
      run.frightMs = 6500 + meta.upgrades.fright * 1500;
      run.message = 'Power pellet. The sentries are vulnerable.';
    }
    if (run.pellets.size === 0) {
      completeLevel();
    }
    updateHud();
  }

  function completeLevel() {
    run.score += 500 + run.level * 150;
    run.earned += 12 + run.level * 3;
    run.level += 1;
    run.message = `Level ${run.level}. The maze resets, but the run keeps climbing.`;
    meta.bestLevel = Math.max(meta.bestLevel || 1, run.level);
    saveProgress();
    loadLevel(run);
    updateHud();
  }

  function movePlayer() {
    const player = run.player;
    if (canMove(player.x, player.y, player.nextDir)) player.dir = player.nextDir;
    if (canMove(player.x, player.y, player.dir)) {
      player.x += player.dir.x;
      player.y += player.dir.y;
      collectAt(player);
    }
  }

  function chooseGhostDir(ghost) {
    let options = openNeighbors(ghost, false);
    if (!options.length) options = openNeighbors(ghost, true);
    if (!options.length) return { x: 0, y: 0 };

    const player = run.player;
    const chase = run.frightMs <= 0 && Math.random() > 0.18;
    const scored = options.map((dir) => {
      const nx = ghost.x + dir.x;
      const ny = ghost.y + dir.y;
      const distance = Math.abs(nx - player.x) + Math.abs(ny - player.y);
      return { dir, distance };
    });

    scored.sort((a, b) => chase ? a.distance - b.distance : b.distance - a.distance);
    return scored[0].dir;
  }

  function moveGhosts() {
    run.ghosts.forEach((ghost) => {
      if (ghost.eatenMs > 0) return;
      if (!canMove(ghost.x, ghost.y, ghost.dir) || Math.random() < 0.32) {
        ghost.dir = chooseGhostDir(ghost);
      }
      if (canMove(ghost.x, ghost.y, ghost.dir)) {
        ghost.x += ghost.dir.x;
        ghost.y += ghost.dir.y;
      }
    });
  }

  function resetPositionsAfterHit() {
    const parsed = parseLevel();
    run.player.x = parsed.player.x;
    run.player.y = parsed.player.y;
    run.player.dir = { x: 1, y: 0 };
    run.player.nextDir = { x: 1, y: 0 };
    run.player.invulnMs = 1600;
    run.ghosts.forEach((ghost, index) => {
      const home = parsed.ghosts[index % parsed.ghosts.length];
      ghost.x = home.x;
      ghost.y = home.y;
      ghost.dir = DIR_ORDER[index % DIR_ORDER.length];
      ghost.eatenMs = 0;
    });
  }

  function checkCollisions() {
    if (!run || run.mode !== 'running') return;
    const player = run.player;
    if (player.phaseMs > 0 || player.invulnMs > 0) return;
    for (const ghost of run.ghosts) {
      if (!sameTile(player, ghost) || ghost.eatenMs > 0) continue;
      if (run.frightMs > 0) {
        run.score += 200;
        run.earned += 4;
        ghost.x = ghost.home.x;
        ghost.y = ghost.home.y;
        ghost.eatenMs = 1800;
        run.message = 'Sentry banished. Keep moving.';
        updateHud();
        continue;
      }
      run.lives -= 1;
      if (run.lives <= 0) {
        endRun('Run ended. Spend Echoes, buy a power, and try again.');
      } else {
        run.message = `Hit. ${run.lives} ${run.lives === 1 ? 'life' : 'lives'} left.`;
        resetPositionsAfterHit();
      }
      updateHud();
      break;
    }
  }

  function step(delta) {
    if (!run || run.mode !== 'running') return;
    run.frightMs = Math.max(0, run.frightMs - delta);
    run.player.phaseMs = Math.max(0, run.player.phaseMs - delta);
    run.player.invulnMs = Math.max(0, run.player.invulnMs - delta);
    run.ghosts.forEach((ghost) => {
      ghost.eatenMs = Math.max(0, ghost.eatenMs - delta);
    });

    run.player.moveMs += delta;
    while (run.player.moveMs >= playerInterval()) {
      run.player.moveMs -= playerInterval();
      movePlayer();
      checkCollisions();
    }

    run.ghostMs += delta;
    while (run.ghostMs >= ghostInterval()) {
      run.ghostMs -= ghostInterval();
      moveGhosts();
      checkCollisions();
    }
  }

  function payoutForRun() {
    if (!run) return 0;
    const base = Math.floor(run.earned / 3) + Math.floor(run.score / 120) + Math.max(0, run.level - 1) * 8;
    const multiplier = 1 + meta.upgrades.payout * 0.15;
    return Math.floor(base * multiplier);
  }

  function endRun(message) {
    if (!run || run.mode === 'ended') return;
    const payout = payoutForRun();
    run.mode = 'ended';
    run.message = `${message} You banked ${payout} Echoes.`;
    meta.echoes += payout;
    meta.bestScore = Math.max(meta.bestScore || 0, run.score);
    meta.bestLevel = Math.max(meta.bestLevel || 1, run.level);
    saveProgress();
    renderShop();
    updateHud();
  }

  function startRun() {
    run = createRun();
    updateHud();
    renderShop();
    if (sceneRef) {
      sceneRef.drawStatic();
      sceneRef.drawDynamic();
    }
  }

  function togglePause() {
    if (!run) return;
    if (run.mode === 'running') {
      run.mode = 'paused';
      run.message = 'Paused.';
    } else if (run.mode === 'paused') {
      run.mode = 'running';
      run.message = 'Back in the maze.';
    }
    updateHud();
  }

  function upgradeCost(def) {
    return def.cost(meta.upgrades[def.key] || 0);
  }

  function buyUpgrade(key) {
    const def = UPGRADES.find((item) => item.key === key);
    if (!def) return;
    const level = meta.upgrades[key] || 0;
    if (level >= def.max) return;
    const cost = upgradeCost(def);
    if (meta.echoes < cost) return;
    meta.echoes -= cost;
    meta.upgrades[key] = level + 1;
    saveProgress();
    renderShop();
    updateHud();
  }

  function resetProgress() {
    if (!window.confirm('Reset Maze Rogue progress and upgrades?')) return;
    meta = defaultProgress();
    saveProgress();
    renderShop();
    updateHud();
  }

  function renderShop() {
    if (!dom.shop) return;
    dom.shop.innerHTML = '';
    UPGRADES.forEach((def) => {
      const level = meta.upgrades[def.key] || 0;
      const maxed = level >= def.max;
      const cost = upgradeCost(def);
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div>
          <strong>${def.name}</strong>
          <span>${def.description}</span>
          <small>Level ${level}/${def.max}${maxed ? ' - maxed' : ` - ${cost} Echoes`}</small>
        </div>
      `;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-button';
      button.textContent = maxed ? 'Max' : 'Buy';
      button.disabled = maxed || meta.echoes < cost || (run && run.mode === 'running');
      button.addEventListener('click', () => buyUpgrade(def.key));
      row.appendChild(button);
      dom.shop.appendChild(row);
    });
  }

  function updateHud() {
    const active = run && run.mode !== 'ended';
    if (dom.bank) dom.bank.textContent = String(meta.echoes);
    if (dom.score) dom.score.textContent = run ? String(run.score) : '0';
    if (dom.level) dom.level.textContent = run ? String(run.level) : '1';
    if (dom.lives) dom.lives.textContent = run ? String(run.lives) : String(3 + meta.upgrades.lives);
    if (dom.best) dom.best.textContent = `${meta.bestScore || 0} / L${meta.bestLevel || 1}`;
    if (dom.phase) {
      const charges = run ? run.player.phaseCharges : meta.upgrades.phase;
      const activePhase = run && run.player.phaseMs > 0 ? ' active' : '';
      dom.phase.textContent = `${charges}${activePhase}`;
    }
    if (dom.runEchoes) dom.runEchoes.textContent = run ? String(payoutForRun()) : '0';
    if (dom.message) {
      dom.message.textContent = run ? run.message : 'Buy a power, start a run, and clear dots for Echoes.';
    }
    if (dom.start) dom.start.textContent = run && run.mode === 'ended' ? 'Start new run' : 'Start run';
    if (dom.pause) {
      dom.pause.disabled = !active;
      dom.pause.textContent = run && run.mode === 'paused' ? 'Resume' : 'Pause';
    }
  }

  function tileCenter(value) {
    return value * TILE + TILE / 2;
  }

  class MazeScene extends Phaser.Scene {
    constructor() {
      super('MazeScene');
    }

    create() {
      sceneRef = this;
      this.wallGraphics = this.add.graphics();
      this.dotGraphics = this.add.graphics();
      this.entityGraphics = this.add.graphics();
      this.drawStatic();
      this.drawDynamic();
      updateHud();
    }

    update(time, delta) {
      step(delta);
      this.drawDynamic();
    }

    drawStatic() {
      if (!this.wallGraphics) return;
      this.wallGraphics.clear();
      this.wallGraphics.fillStyle(0x07110f, 1);
      this.wallGraphics.fillRect(0, 0, WIDTH, HEIGHT);
      this.wallGraphics.fillStyle(0x173f38, 1);
      this.wallGraphics.lineStyle(1, 0x2a6d61, 0.55);
      MAP.forEach((row, y) => {
        [...row].forEach((char, x) => {
          if (char !== '#') return;
          const px = x * TILE + 2;
          const py = y * TILE + 2;
          this.wallGraphics.fillRoundedRect(px, py, TILE - 4, TILE - 4, 6);
          this.wallGraphics.strokeRoundedRect(px + 0.5, py + 0.5, TILE - 5, TILE - 5, 6);
        });
      });
    }

    drawDots() {
      this.dotGraphics.clear();
      if (!run) return;
      run.pellets.forEach((posKey) => {
        const [x, y] = posKey.split(',').map(Number);
        const isPower = run.powers.has(posKey);
        const cx = tileCenter(x);
        const cy = tileCenter(y);
        this.dotGraphics.fillStyle(isPower ? 0xd7b56d : 0xf7efd3, 1);
        this.dotGraphics.fillCircle(cx, cy, isPower ? 6 : 2.6);
        if (isPower) {
          this.dotGraphics.lineStyle(1.5, 0xfff2b8, 0.55);
          this.dotGraphics.strokeCircle(cx, cy, 9);
        }
      });
    }

    drawPlayer() {
      if (!run) return;
      const player = run.player;
      const cx = tileCenter(player.x);
      const cy = tileCenter(player.y);
      const phased = player.phaseMs > 0;
      const blinking = player.invulnMs > 0 && Math.floor(player.invulnMs / 120) % 2 === 0;
      if (blinking) return;
      this.entityGraphics.fillStyle(phased ? 0x82ffe5 : 0xffd84a, phased ? 0.8 : 1);
      this.entityGraphics.fillCircle(cx, cy, 10.5);
      this.entityGraphics.fillStyle(0x07110f, 1);
      const dx = player.dir.x;
      const dy = player.dir.y;
      if (dx > 0) this.entityGraphics.fillTriangle(cx, cy, cx + 12, cy - 7, cx + 12, cy + 7);
      if (dx < 0) this.entityGraphics.fillTriangle(cx, cy, cx - 12, cy - 7, cx - 12, cy + 7);
      if (dy > 0) this.entityGraphics.fillTriangle(cx, cy, cx - 7, cy + 12, cx + 7, cy + 12);
      if (dy < 0) this.entityGraphics.fillTriangle(cx, cy, cx - 7, cy - 12, cx + 7, cy - 12);
    }

    drawGhost(ghost) {
      const cx = tileCenter(ghost.x);
      const cy = tileCenter(ghost.y);
      const vulnerable = run && run.frightMs > 0;
      const hidden = ghost.eatenMs > 0 && Math.floor(ghost.eatenMs / 120) % 2 === 0;
      if (hidden) return;
      this.entityGraphics.fillStyle(vulnerable ? 0x3c5dff : ghost.color, ghost.eatenMs > 0 ? 0.45 : 1);
      this.entityGraphics.fillRoundedRect(cx - 10, cy - 10, 20, 22, 8);
      this.entityGraphics.fillStyle(0xffffff, 1);
      this.entityGraphics.fillCircle(cx - 4, cy - 2, 3);
      this.entityGraphics.fillCircle(cx + 4, cy - 2, 3);
      this.entityGraphics.fillStyle(0x07110f, 1);
      this.entityGraphics.fillCircle(cx - 4 + ghost.dir.x, cy - 2 + ghost.dir.y, 1.4);
      this.entityGraphics.fillCircle(cx + 4 + ghost.dir.x, cy - 2 + ghost.dir.y, 1.4);
    }

    drawDynamic() {
      if (!this.entityGraphics) return;
      this.drawDots();
      this.entityGraphics.clear();
      if (!run) return;
      run.ghosts.forEach((ghost) => this.drawGhost(ghost));
      this.drawPlayer();
    }
  }

  function initPhaser() {
    if (!window.Phaser) {
      if (dom.message) dom.message.textContent = 'The game engine did not load. Please refresh the page.';
      return;
    }
    phaserGame = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'maze-game',
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#07110f',
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [MazeScene]
    });
  }

  function bindDom() {
    dom.bank = byId('mr-bank');
    dom.score = byId('mr-score');
    dom.level = byId('mr-level');
    dom.lives = byId('mr-lives');
    dom.best = byId('mr-best');
    dom.phase = byId('mr-phase');
    dom.runEchoes = byId('mr-run-echoes');
    dom.message = byId('mr-message');
    dom.shop = byId('mr-shop');
    dom.start = byId('mr-start');
    dom.pause = byId('mr-pause');
    dom.reset = byId('mr-reset');

    if (dom.start) dom.start.addEventListener('click', startRun);
    if (dom.pause) dom.pause.addEventListener('click', togglePause);
    if (dom.reset) dom.reset.addEventListener('click', resetProgress);
    document.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => setDirection(button.dataset.move));
      button.addEventListener('pointerdown', () => setDirection(button.dataset.move));
    });
    const phaseButton = byId('mr-phase-button');
    if (phaseButton) phaseButton.addEventListener('click', activatePhase);

    window.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      const map = {
        arrowleft: 'left',
        a: 'left',
        arrowright: 'right',
        d: 'right',
        arrowup: 'up',
        w: 'up',
        arrowdown: 'down',
        s: 'down'
      };
      if (map[key]) {
        event.preventDefault();
        setDirection(map[key]);
      } else if (key === ' ') {
        event.preventDefault();
        activatePhase();
      } else if (key === 'enter' && (!run || run.mode === 'ended')) {
        startRun();
      } else if (key === 'p') {
        togglePause();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindDom();
    renderShop();
    updateHud();
    initPhaser();
  });

  window.mazeRogue = {
    startRun,
    setDirection,
    activatePhase,
    getState: () => ({ run, meta, phaserGame })
  };
})();
