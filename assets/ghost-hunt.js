const board = document.getElementById('board');
const ctx = board.getContext('2d');
const levelLabel = document.getElementById('levelLabel');
const orbsLabel = document.getElementById('orbsLabel');
const escapesLabel = document.getElementById('escapesLabel');
const statusEl = document.getElementById('status');
const restartBtn = document.getElementById('restartBtn');
const nextBtn = document.getElementById('nextBtn');

const TILE = 24;
const TICK_MS = 155;
const TEAM_COLORS = ['#f87171', '#60a5fa', '#f472b6', '#fb923c'];
const RUNNER_COLOR = '#facc15';

const LEVELS = [
  {
    maze: [
      '##############################',
      '#............##..............#',
      '#.####.#####.##.#####.####.#.#',
      '#.#........#....#.......#.#..#',
      '#.#.######.######.#####.#.##.#',
      '#.#......#....##....#...#....#',
      '#.######.###.####.###.####.#.#',
      '#........#..........#......#.#',
      '########.#.########.#.######.#',
      '#........#....##....#........#',
      '#.######.####.##.####.######.#',
      '#............................#',
      '##############################'
    ],
    ghosts: [{ x: 14, y: 6 }, { x: 13, y: 6 }, { x: 15, y: 6 }, { x: 14, y: 5 }],
    runner: { x: 2, y: 1 },
    runnerSpeed: 1,
    lookAhead: 6
  },
  {
    maze: [
      '##############################',
      '#.....#........##.........#..#',
      '#.###.#.######.##.######..#..#',
      '#.#...#......#....#....#..#..#',
      '#.#.#######.######.##.#.###.##',
      '#.#.....#....##....##.#......#',
      '#.#####.#.##.####.##..######.#',
      '#.......#.#........#.........#',
      '###.#####.#.######.#.#######.#',
      '#...#.....#....##..#......#..#',
      '#.#.#.########.##.######.#.#.#',
      '#.#......................#...#',
      '##############################'
    ],
    ghosts: [{ x: 14, y: 6 }, { x: 13, y: 6 }, { x: 15, y: 6 }, { x: 14, y: 7 }],
    runner: { x: 27, y: 11 },
    runnerSpeed: 1,
    lookAhead: 8
  },
  {
    maze: [
      '##############################',
      '#......#......##.......#.....#',
      '#.####.#.####.##.#####.#.###.#',
      '#.#....#....#....#.....#...#.#',
      '#.#.######.#.####.#.######.#.#',
      '#.#......#.#....#.#......#.#.#',
      '#.######.#.####.#.######.#.#.#',
      '#......#.#......#....#...#.#.#',
      '######.#.##########.#.###.#.#.',
      '#....#.#....##......#.#...#..#',
      '#.##.#.####.##.######.#.####.#',
      '#....#................#......#',
      '##############################'
    ],
    ghosts: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 1 }],
    runner: { x: 27, y: 11 },
    runnerSpeed: 2,
    lookAhead: 11
  }
];

let state = null;
let timer = null;
let inputDir = { x: 0, y: 0 };

function cloneEntity(e) {
  return { x: e.x, y: e.y, dir: { x: 0, y: 0 }, prev: { x: e.x, y: e.y } };
}

function getLevelConfig(index) {
  return LEVELS[Math.min(index, LEVELS.length - 1)];
}

function initState(level = 0) {
  const config = getLevelConfig(level);
  const maze = config.maze.map((row) => row.split(''));
  const orbs = new Set();
  maze.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell === '.') orbs.add(`${x},${y}`);
    });
  });

  state = {
    level,
    maze,
    width: maze[0].length,
    height: maze.length,
    orbs,
    ghosts: config.ghosts.map(cloneEntity),
    runner: cloneEntity(config.runner),
    runnerSpeed: config.runnerSpeed,
    lookAhead: config.lookAhead,
    outcome: 'playing',
    escapes: state?.escapes || 0,
    tick: 0
  };

  board.width = state.width * TILE;
  board.height = state.height * TILE;
  inputDir = { x: 0, y: 0 };
  nextBtn.style.display = 'none';
  updateHud();
  setStatus(`Maze ${state.level + 1}: trap the runner before all ${state.orbs.size} orbs disappear.`);
}

function isWall(x, y) {
  if (y < 0 || y >= state.height || x < 0 || x >= state.width) return true;
  return state.maze[y][x] === '#';
}

function neighbors(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ].filter((p) => !isWall(p.x, p.y));
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chooseGreedyStep(start, target, avoid = null) {
  const opts = neighbors(start.x, start.y);
  if (!opts.length) return { x: start.x, y: start.y };

  opts.sort((a, b) => {
    const aScore = manhattan(a, target) + (avoid ? Math.max(0, 3 - manhattan(a, avoid)) * 4 : 0);
    const bScore = manhattan(b, target) + (avoid ? Math.max(0, 3 - manhattan(b, avoid)) * 4 : 0);
    return aScore - bScore;
  });

  return opts[0];
}

function computeRunnerTarget() {
  const queue = [{ x: state.runner.x, y: state.runner.y, path: [] }];
  const seen = new Set([`${state.runner.x},${state.runner.y}`]);
  const ghostCells = state.ghosts.map((g) => `${g.x},${g.y}`);

  while (queue.length) {
    const node = queue.shift();
    const key = `${node.x},${node.y}`;
    if (state.orbs.has(key)) {
      return node.path[0] || node;
    }

    for (const n of neighbors(node.x, node.y)) {
      const nk = `${n.x},${n.y}`;
      if (seen.has(nk)) continue;
      seen.add(nk);
      const riskPenalty = ghostCells.includes(nk) ? state.lookAhead : 0;
      queue.push({ x: n.x, y: n.y, path: [...node.path, { x: n.x, y: n.y }], riskPenalty });
    }

    queue.sort((a, b) => (a.path.length + a.riskPenalty) - (b.path.length + b.riskPenalty));
  }

  const fallback = neighbors(state.runner.x, state.runner.y);
  return fallback[Math.floor(Math.random() * fallback.length)] || { x: state.runner.x, y: state.runner.y };
}

function movePlayerGhost() {
  const player = state.ghosts[0];
  const nx = player.x + inputDir.x;
  const ny = player.y + inputDir.y;
  if (!isWall(nx, ny)) {
    player.prev = { x: player.x, y: player.y };
    player.x = nx;
    player.y = ny;
  }
}

function moveAIGhosts() {
  const runner = state.runner;
  for (let i = 1; i < state.ghosts.length; i += 1) {
    const ghost = state.ghosts[i];
    let target = { x: runner.x, y: runner.y };

    if (i === 1) target = { x: Math.max(1, runner.x - 2), y: runner.y };
    if (i === 2) target = { x: runner.x, y: Math.max(1, runner.y - 2) };
    if (i === 3) target = { x: Math.min(state.width - 2, runner.x + 2), y: runner.y };

    const step = chooseGreedyStep(ghost, target);
    ghost.prev = { x: ghost.x, y: ghost.y };
    ghost.x = step.x;
    ghost.y = step.y;
  }
}

function moveRunner() {
  for (let i = 0; i < state.runnerSpeed; i += 1) {
    const next = computeRunnerTarget();
    state.runner.prev = { x: state.runner.x, y: state.runner.y };
    state.runner.x = next.x;
    state.runner.y = next.y;
    state.orbs.delete(`${state.runner.x},${state.runner.y}`);
    if (checkCapture()) return;
  }
}

function checkCapture() {
  return state.ghosts.some((g) => g.x === state.runner.x && g.y === state.runner.y);
}

function updateGame() {
  if (!state || state.outcome !== 'playing') return;

  state.tick += 1;
  movePlayerGhost();
  moveAIGhosts();

  if (checkCapture()) {
    state.outcome = 'captured';
    if (state.level >= LEVELS.length - 1) {
      setStatus('You caught the runner in the final maze. Ghost squad victory 👻🏆');
    } else {
      setStatus('Runner captured! Press Next Maze for a tougher labyrinth.');
      nextBtn.style.display = 'inline-block';
    }
    updateHud();
    return;
  }

  moveRunner();

  if (checkCapture()) {
    state.outcome = 'captured';
    if (state.level >= LEVELS.length - 1) {
      setStatus('You caught the runner in the final maze. Ghost squad victory 👻🏆');
    } else {
      setStatus('Runner captured! Press Next Maze for a tougher labyrinth.');
      nextBtn.style.display = 'inline-block';
    }
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

function draw() {
  if (!state) return;

  ctx.clearRect(0, 0, board.width, board.height);

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

        if (state.orbs.has(`${x},${y}`)) {
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(px + TILE / 2, py + TILE / 2, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  state.ghosts.forEach((ghost, index) => {
    const px = ghost.x * TILE;
    const py = ghost.y * TILE;
    ctx.fillStyle = TEAM_COLORS[index];
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, 9, Math.PI, 0);
    ctx.lineTo(px + TILE - 3, py + TILE - 3);
    ctx.lineTo(px + 3, py + TILE - 3);
    ctx.closePath();
    ctx.fill();
  });

  const rpX = state.runner.x * TILE;
  const rpY = state.runner.y * TILE;
  ctx.fillStyle = RUNNER_COLOR;
  ctx.beginPath();
  ctx.arc(rpX + TILE / 2, rpY + TILE / 2, 8.5, 0.15 * Math.PI, 1.85 * Math.PI);
  ctx.lineTo(rpX + TILE / 2, rpY + TILE / 2);
  ctx.fill();

  requestAnimationFrame(draw);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateHud() {
  levelLabel.textContent = `${Math.min(state.level + 1, LEVELS.length)}`;
  orbsLabel.textContent = `${state.orbs.size}`;
  escapesLabel.textContent = `${state.escapes}`;
}

function startLoop() {
  if (timer) clearInterval(timer);
  timer = setInterval(updateGame, TICK_MS);
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (['arrowup', 'w'].includes(key)) inputDir = { x: 0, y: -1 };
  if (['arrowdown', 's'].includes(key)) inputDir = { x: 0, y: 1 };
  if (['arrowleft', 'a'].includes(key)) inputDir = { x: -1, y: 0 };
  if (['arrowright', 'd'].includes(key)) inputDir = { x: 1, y: 0 };
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

initState(0);
startLoop();
requestAnimationFrame(draw);
