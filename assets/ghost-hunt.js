const board = document.getElementById('board');
const ctx = board.getContext('2d');
const levelLabel = document.getElementById('levelLabel');
const orbsLabel = document.getElementById('orbsLabel');
const escapesLabel = document.getElementById('escapesLabel');
const statusEl = document.getElementById('status');
const restartBtn = document.getElementById('restartBtn');
const nextBtn = document.getElementById('nextBtn');

const TILE = 24;
const TEAM_COLORS = ['#f87171', '#60a5fa', '#f472b6', '#fb923c'];
const RUNNER_COLOR = '#facc15';

const PLAYER_SPEED = 5.3; // tiles / second
const AI_BASE_SPEED = 4.55;
const RUNNER_BASE_SPEED = 4.2;

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

const LEVELS = [
  {
    ghosts: [{ x: 14, y: 6 }, { x: 13, y: 6 }, { x: 15, y: 6 }, { x: 14, y: 5 }],
    runner: { x: 2, y: 1 },
    runnerSpeedBoost: 0,
    runnerRiskBias: 1.3
  },
  {
    ghosts: [{ x: 14, y: 6 }, { x: 13, y: 6 }, { x: 15, y: 6 }, { x: 14, y: 7 }],
    runner: { x: 27, y: 11 },
    runnerSpeedBoost: 0.45,
    runnerRiskBias: 1.9
  },
  {
    ghosts: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 2 }, { x: 4, y: 1 }],
    runner: { x: 27, y: 11 },
    runnerSpeedBoost: 0.9,
    runnerRiskBias: 2.7
  }
];

let state = null;
let lastTime = 0;

function makeEntity(spawn, speed, color) {
  return {
    x: spawn.x,
    y: spawn.y,
    dir: { x: 0, y: 0 },
    desired: { x: 0, y: 0 },
    speed,
    color
  };
}

function getLevelConfig(index) {
  return LEVELS[Math.min(index, LEVELS.length - 1)];
}

function keyOf(x, y) {
  return `${x},${y}`;
}

function generateMaze(level) {
  const width = 30;
  const height = 13;
  const maze = Array.from({ length: height }, (_, y) => (
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.'))
  ));

  const columnSets = [
    [7, 14, 21],
    [6, 11, 16, 21, 25],
    [5, 9, 13, 17, 21, 25]
  ];

  const cols = columnSets[Math.min(level, columnSets.length - 1)];

  cols.forEach((col, idx) => {
    for (let y = 1; y < height - 1; y += 1) {
      const gapA = 2 + ((idx + level) % 3) * 3;
      const gapB = 3 + ((idx + level * 2) % 3) * 3;
      const gapC = 4 + ((idx + level) % 2) * 4;
      if (y === gapA || y === gapB || y === gapC) continue;
      maze[y][col] = '#';
    }
  });

  return maze;
}

function getWalkNeighbors(maze, x, y) {
  return DIRS
    .map((d) => ({ x: x + d.x, y: y + d.y }))
    .filter((n) => n.y >= 0 && n.y < maze.length && n.x >= 0 && n.x < maze[0].length && maze[n.y][n.x] !== '#');
}

function validateMazeAndSpawns(maze, runnerSpawn, ghostSpawns) {
  const h = maze.length;
  const w = maze[0].length;

  const inBounds = (p) => p.x > 0 && p.x < w - 1 && p.y > 0 && p.y < h - 1;
  const walkable = (p) => inBounds(p) && maze[p.y][p.x] !== '#';

  if (!walkable(runnerSpawn) || ghostSpawns.some((g) => !walkable(g))) {
    return false;
  }

  const q = [runnerSpawn];
  const seen = new Set([keyOf(runnerSpawn.x, runnerSpawn.y)]);
  while (q.length) {
    const cur = q.shift();
    for (const n of getWalkNeighbors(maze, cur.x, cur.y)) {
      const k = keyOf(n.x, n.y);
      if (!seen.has(k)) {
        seen.add(k);
        q.push(n);
      }
    }
  }

  if (ghostSpawns.some((g) => !seen.has(keyOf(g.x, g.y)))) return false;

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (maze[y][x] === '#') continue;
      if (!seen.has(keyOf(x, y))) return false;
    }
  }

  return true;
}

function nearestWalkable(maze, start) {
  const h = maze.length;
  const w = maze[0].length;
  if (start.y >= 0 && start.y < h && start.x >= 0 && start.x < w && maze[start.y][start.x] !== '#') {
    return { x: start.x, y: start.y };
  }
  const q = [{ x: Math.min(w - 2, Math.max(1, start.x)), y: Math.min(h - 2, Math.max(1, start.y)) }];
  const seen = new Set([keyOf(q[0].x, q[0].y)]);
  while (q.length) {
    const cur = q.shift();
    if (maze[cur.y][cur.x] !== '#') return cur;
    for (const d of DIRS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) continue;
      const k = keyOf(nx, ny);
      if (!seen.has(k)) {
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
  }
  return { x: 1, y: 1 };
}

function initState(level = 0) {
  const config = getLevelConfig(level);
  let maze = generateMaze(level);

  let runnerSpawn = nearestWalkable(maze, config.runner);
  let ghostSpawns = config.ghosts.map((g) => nearestWalkable(maze, g));

  if (!validateMazeAndSpawns(maze, runnerSpawn, ghostSpawns)) {
    // Fallback to a very safe open-connected arena layout.
    maze = maze.map((row, y) => row.map((cell, x) => {
      if (y === 0 || x === 0 || y === maze.length - 1 || x === row.length - 1) return '#';
      return '.';
    }));
    runnerSpawn = nearestWalkable(maze, runnerSpawn);
    ghostSpawns = ghostSpawns.map((g) => nearestWalkable(maze, g));
  }

  const orbs = new Set();
  for (let y = 1; y < maze.length - 1; y += 1) {
    for (let x = 1; x < maze[0].length - 1; x += 1) {
      if (maze[y][x] === '#') continue;
      const degree = getWalkNeighbors(maze, x, y).length;
      // Never place an orb in a dead end / funnel point.
      if (degree >= 2) orbs.add(keyOf(x, y));
    }
  }

  state = {
    level,
    maze,
    width: maze[0].length,
    height: maze.length,
    orbs,
    ghosts: ghostSpawns.map((g, i) => makeEntity(g, i === 0 ? PLAYER_SPEED : AI_BASE_SPEED + level * 0.2, TEAM_COLORS[i])),
    runner: makeEntity(runnerSpawn, RUNNER_BASE_SPEED + config.runnerSpeedBoost, RUNNER_COLOR),
    runnerRiskBias: config.runnerRiskBias,
    outcome: 'playing',
    escapes: state?.escapes || 0
  };

  // Remove orb at starting positions.
  state.orbs.delete(keyOf(Math.round(state.runner.x), Math.round(state.runner.y)));
  state.ghosts.forEach((g) => state.orbs.delete(keyOf(Math.round(g.x), Math.round(g.y))));

  // Seed initial directions so everyone starts moving immediately.
  for (let i = 1; i < state.ghosts.length; i += 1) {
    const g = state.ghosts[i];
    const start = { x: Math.round(g.x), y: Math.round(g.y) };
    const target = nearestWalkable(state.maze, aiTargetForGhost(i));
    const step = shortestPathStep(start, target);
    g.dir = step ? { x: Math.sign(step.x - start.x), y: Math.sign(step.y - start.y) } : pickFallbackDirection(start, null);
  }
  const runnerStart = { x: Math.round(state.runner.x), y: Math.round(state.runner.y) };
  const runnerStep = chooseRunnerTargetCell();
  state.runner.dir = runnerStep
    ? { x: Math.sign(runnerStep.x - runnerStart.x), y: Math.sign(runnerStep.y - runnerStart.y) }
    : pickFallbackDirection(runnerStart, null);

  board.width = state.width * TILE;
  board.height = state.height * TILE;
  nextBtn.style.display = 'none';
  updateHud();
  setStatus(`Maze ${state.level + 1}: cut off lanes and trap the runner before all ${state.orbs.size} orbs are eaten.`);
}

function isWall(x, y) {
  if (y < 0 || y >= state.height || x < 0 || x >= state.width) return true;
  return state.maze[y][x] === '#';
}

function canMoveToCell(x, y) {
  return !isWall(Math.round(x), Math.round(y));
}

function isNearCenter(entity, epsilon = 0.06) {
  return Math.abs(entity.x - Math.round(entity.x)) < epsilon && Math.abs(entity.y - Math.round(entity.y)) < epsilon;
}

function snapToCenter(entity) {
  entity.x = Math.round(entity.x);
  entity.y = Math.round(entity.y);
}

function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

function maybeTurn(entity, preferredDir) {
  if (!isNearCenter(entity)) return;

  snapToCenter(entity);
  if (!preferredDir || (preferredDir.x === 0 && preferredDir.y === 0)) return;

  const nx = entity.x + preferredDir.x;
  const ny = entity.y + preferredDir.y;
  if (canMoveToCell(nx, ny)) {
    entity.dir = { ...preferredDir };
  }
}

function moveEntity(entity, dt) {
  if (entity.dir.x === 0 && entity.dir.y === 0) return;

  const step = entity.speed * dt;
  const nextX = entity.x + entity.dir.x * step;
  const nextY = entity.y + entity.dir.y * step;

  const targetCellX = Math.round(nextX);
  const targetCellY = Math.round(nextY);

  if (canMoveToCell(targetCellX, targetCellY)) {
    entity.x = nextX;
    entity.y = nextY;
  } else if (isNearCenter(entity)) {
    snapToCenter(entity);
    entity.dir = { x: 0, y: 0 };
  }
}

function pickFallbackDirection(cell, currentDir) {
  const options = getWalkNeighbors(state.maze, cell.x, cell.y)
    .map((n) => ({ x: Math.sign(n.x - cell.x), y: Math.sign(n.y - cell.y) }))
    .filter((d) => !currentDir || !isOpposite(d, currentDir));

  if (options.length) return options[0];

  const all = getWalkNeighbors(state.maze, cell.x, cell.y)
    .map((n) => ({ x: Math.sign(n.x - cell.x), y: Math.sign(n.y - cell.y) }));
  return all[0] || { x: 0, y: 0 };
}

function shortestPathStep(start, target, opts = {}) {
  const q = [{ x: start.x, y: start.y }];
  const parents = new Map();
  const seen = new Set([keyOf(start.x, start.y)]);

  while (q.length) {
    const cur = q.shift();
    if (cur.x === target.x && cur.y === target.y) break;

    const dirs = [...DIRS].sort((a, b) => {
      const da = Math.abs((cur.x + a.x) - target.x) + Math.abs((cur.y + a.y) - target.y);
      const db = Math.abs((cur.x + b.x) - target.x) + Math.abs((cur.y + b.y) - target.y);
      return da - db;
    });

    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (isWall(nx, ny)) continue;

      if (opts.avoidReverseFrom && cur.x === start.x && cur.y === start.y && isOpposite(d, opts.avoidReverseFrom)) {
        continue;
      }

      const k = keyOf(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      parents.set(k, { x: cur.x, y: cur.y });
      q.push({ x: nx, y: ny });
    }
  }

  const targetKey = keyOf(target.x, target.y);
  if (!parents.has(targetKey)) return null;

  let cursor = { ...target };
  while (true) {
    const p = parents.get(keyOf(cursor.x, cursor.y));
    if (!p) return null;
    if (p.x === start.x && p.y === start.y) return cursor;
    cursor = p;
  }
}

function ghostDistanceMap() {
  const dist = new Map();
  const q = [];

  state.ghosts.forEach((g) => {
    const sx = Math.round(g.x);
    const sy = Math.round(g.y);
    const k = keyOf(sx, sy);
    dist.set(k, 0);
    q.push({ x: sx, y: sy });
  });

  while (q.length) {
    const cur = q.shift();
    const base = dist.get(keyOf(cur.x, cur.y));
    for (const n of getWalkNeighbors(state.maze, cur.x, cur.y)) {
      const k = keyOf(n.x, n.y);
      if (!dist.has(k)) {
        dist.set(k, base + 1);
        q.push(n);
      }
    }
  }

  return dist;
}

function chooseRunnerTargetCell() {
  const start = { x: Math.round(state.runner.x), y: Math.round(state.runner.y) };
  const ghostDist = ghostDistanceMap();

  const q = [{ ...start, dist: 0 }];
  const seen = new Set([keyOf(start.x, start.y)]);
  const parent = new Map();
  const candidates = [];

  while (q.length) {
    const cur = q.shift();
    const k = keyOf(cur.x, cur.y);

    if (state.orbs.has(k)) {
      const safety = ghostDist.get(k) ?? 0;
      const score = cur.dist - safety * state.runnerRiskBias;
      candidates.push({ x: cur.x, y: cur.y, score, dist: cur.dist });
    }

    for (const n of getWalkNeighbors(state.maze, cur.x, cur.y)) {
      const nk = keyOf(n.x, n.y);
      if (seen.has(nk)) continue;
      seen.add(nk);
      parent.set(nk, { x: cur.x, y: cur.y });
      q.push({ x: n.x, y: n.y, dist: cur.dist + 1 });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score || a.dist - b.dist);
  const target = candidates[0];

  let cursor = { x: target.x, y: target.y };
  while (true) {
    const p = parent.get(keyOf(cursor.x, cursor.y));
    if (!p) return cursor;
    if (p.x === start.x && p.y === start.y) return cursor;
    cursor = p;
  }
}

function updatePlayer(dt) {
  const player = state.ghosts[0];
  maybeTurn(player, player.desired);
  moveEntity(player, dt);
}

function aiTargetForGhost(index) {
  const runner = { x: Math.round(state.runner.x), y: Math.round(state.runner.y) };
  if (index === 1) return { x: Math.max(1, runner.x - 2), y: runner.y };
  if (index === 2) return { x: runner.x, y: Math.max(1, runner.y - 2) };
  if (index === 3) return { x: Math.min(state.width - 2, runner.x + 2), y: runner.y };
  return runner;
}

function updateAIGhosts(dt) {
  for (let i = 1; i < state.ghosts.length; i += 1) {
    const ghost = state.ghosts[i];

    if (isNearCenter(ghost)) {
      snapToCenter(ghost);
      const start = { x: Math.round(ghost.x), y: Math.round(ghost.y) };
      const rawTarget = aiTargetForGhost(i);
      const target = nearestWalkable(state.maze, rawTarget);
      const step = shortestPathStep(start, target, { avoidReverseFrom: ghost.dir });
      if (step) {
        ghost.dir = { x: Math.sign(step.x - start.x), y: Math.sign(step.y - start.y) };
      } else {
        ghost.dir = pickFallbackDirection(start, ghost.dir);
      }
    }

    moveEntity(ghost, dt);
  }
}

function updateRunner(dt) {
  const runner = state.runner;

  if (isNearCenter(runner)) {
    snapToCenter(runner);
    const start = { x: Math.round(runner.x), y: Math.round(runner.y) };
    const nextCell = chooseRunnerTargetCell();
    if (nextCell) {
      runner.dir = { x: Math.sign(nextCell.x - start.x), y: Math.sign(nextCell.y - start.y) };
    } else {
      runner.dir = pickFallbackDirection(start, runner.dir);
    }
  }

  moveEntity(runner, dt);
  state.orbs.delete(keyOf(Math.round(runner.x), Math.round(runner.y)));
}

function checkCapture() {
  const r = state.runner;
  return state.ghosts.some((g) => Math.hypot(g.x - r.x, g.y - r.y) < 0.45);
}

function endWithCapture() {
  state.outcome = 'captured';
  if (state.level >= LEVELS.length - 1) {
    setStatus('You caught the runner in the final maze. Ghost squad victory 👻🏆');
  } else {
    setStatus('Runner captured! Press Next Maze for a tougher labyrinth.');
    nextBtn.style.display = 'inline-block';
  }
}

function updateGame(dt) {
  if (!state || state.outcome !== 'playing') return;

  updatePlayer(dt);
  updateAIGhosts(dt);

  if (checkCapture()) {
    endWithCapture();
    updateHud();
    return;
  }

  updateRunner(dt);

  if (checkCapture()) {
    endWithCapture();
  } else if (!state.orbs.size) {
    state.outcome = 'escaped';
    state.escapes += 1;
    if (state.escapes >= 3) {
      setStatus('The runner escaped three times. Restart and tighten your pincer routes.');
    } else {
      setStatus(`Runner escaped this maze. Escapes: ${state.escapes}/3. Hit Next Maze for revenge.`);
      nextBtn.style.display = 'inline-block';
    }
  }

  updateHud();
}

function drawMaze() {
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const px = x * TILE;
      const py = y * TILE;

      if (state.maze[y][x] === '#') {
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#1e40af';
        ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(px, py, TILE, TILE);
        if (state.orbs.has(keyOf(x, y))) {
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(px + TILE / 2, py + TILE / 2, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

function drawGhost(entity, color) {
  const px = entity.x * TILE;
  const py = entity.y * TILE;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px + TILE / 2, py + TILE / 2, 9, Math.PI, 0);
  ctx.lineTo(px + TILE - 3, py + TILE - 3);
  ctx.lineTo(px + 3, py + TILE - 3);
  ctx.closePath();
  ctx.fill();
}

function drawRunner(entity) {
  const px = entity.x * TILE;
  const py = entity.y * TILE;
  ctx.fillStyle = RUNNER_COLOR;
  ctx.beginPath();
  ctx.arc(px + TILE / 2, py + TILE / 2, 8.5, 0.15 * Math.PI, 1.85 * Math.PI);
  ctx.lineTo(px + TILE / 2, py + TILE / 2);
  ctx.fill();
}

function draw() {
  if (!state) return;
  ctx.clearRect(0, 0, board.width, board.height);
  drawMaze();
  state.ghosts.forEach((g, i) => drawGhost(g, TEAM_COLORS[i]));
  drawRunner(state.runner);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateHud() {
  levelLabel.textContent = `${Math.min(state.level + 1, LEVELS.length)}`;
  orbsLabel.textContent = `${state.orbs.size}`;
  escapesLabel.textContent = `${state.escapes}`;
}

window.addEventListener('keydown', (e) => {
  if (!state || !state.ghosts?.length) return;
  const key = e.key.toLowerCase();
  if (['arrowup', 'w'].includes(key)) state.ghosts[0].desired = { x: 0, y: -1 };
  if (['arrowdown', 's'].includes(key)) state.ghosts[0].desired = { x: 0, y: 1 };
  if (['arrowleft', 'a'].includes(key)) state.ghosts[0].desired = { x: -1, y: 0 };
  if (['arrowright', 'd'].includes(key)) state.ghosts[0].desired = { x: 1, y: 0 };
});

restartBtn.addEventListener('click', () => {
  initState(0);
});

nextBtn.addEventListener('click', () => {
  const nextLevel = Math.min(state.level + 1, LEVELS.length - 1);
  if (state.outcome === 'escaped' && state.escapes >= 3) {
    initState(0);
    state.escapes = 0;
  } else {
    initState(nextLevel);
  }
});

function frame(now) {
  if (!lastTime) lastTime = now;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  updateGame(dt);
  draw();

  requestAnimationFrame(frame);
}

initState(0);
requestAnimationFrame(frame);
