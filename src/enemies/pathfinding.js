import { isWalkableCell } from '../gen/validator.js';

/**
 * Grid-based A* Pathfinding and DDA Line-of-Sight raycasting on the level grid.
 */
export function findPathAStar(
  grid,
  width,
  height,
  startX,
  startZ,
  goalX,
  goalZ,
  maxIterations = 600
) {
  const inBounds = (x, z) => x >= 0 && x < width && z >= 0 && z < height;
  const idx = (x, z) => z * width + x;

  const sx = Math.max(0, Math.min(width - 1, Math.round(startX)));
  const sz = Math.max(0, Math.min(height - 1, Math.round(startZ)));
  const gx = Math.max(0, Math.min(width - 1, Math.round(goalX)));
  const gz = Math.max(0, Math.min(height - 1, Math.round(goalZ)));

  if (!inBounds(sx, sz) || !inBounds(gx, gz)) return [];
  if (!isWalkableCell(grid[idx(gx, gz)])) return [];
  if (sx === gx && sz === gz) return [{ x: gx, z: gz }];

  const totalCells = width * height;
  const gScore = new Float32Array(totalCells).fill(Infinity);
  const fScore = new Float32Array(totalCells).fill(Infinity);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const closed = new Uint8Array(totalCells);

  const startIdx = idx(sx, sz);
  const goalIdx = idx(gx, gz);

  gScore[startIdx] = 0;
  fScore[startIdx] = Math.abs(gx - sx) + Math.abs(gz - sz);

  // Simple binary-heap / sorted open list
  const openSet = [startIdx];

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  let iterations = 0;
  let closestNode = startIdx;
  let closestHeuristic = fScore[startIdx];

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Pop node with lowest fScore
    let bestPos = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (fScore[openSet[i]] < fScore[openSet[bestPos]]) {
        bestPos = i;
      }
    }
    const current = openSet[bestPos];
    openSet.splice(bestPos, 1);

    if (current === goalIdx) {
      return reconstructPath(cameFrom, current, width);
    }

    closed[current] = 1;
    const cx = current % width;
    const cz = (current / width) | 0;

    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d][0];
      const nz = cz + dirs[d][1];
      if (!inBounds(nx, nz)) continue;

      const nIdx = idx(nx, nz);
      if (closed[nIdx]) continue;
      if (!isWalkableCell(grid[nIdx])) continue;

      const tentativeG = gScore[current] + 1;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        const h = Math.abs(gx - nx) + Math.abs(gz - nz);
        fScore[nIdx] = tentativeG + h;

        if (h < closestHeuristic) {
          closestHeuristic = h;
          closestNode = nIdx;
        }

        if (!openSet.includes(nIdx)) {
          openSet.push(nIdx);
        }
      }
    }
  }

  // Return partial path to closest reachable node if maxIterations hit
  if (closestNode !== startIdx) {
    return reconstructPath(cameFrom, closestNode, width);
  }
  return [];
}

function reconstructPath(cameFrom, current, width) {
  const path = [];
  let curr = current;
  while (curr !== -1) {
    path.push({
      x: curr % width,
      z: (curr / width) | 0
    });
    curr = cameFrom[curr];
  }
  path.reverse();
  // Drop index 0 (current cell) if there are further waypoints
  if (path.length > 1) {
    path.shift();
  }
  return path;
}

/**
 * Checks unbroken line-of-sight between two world positions (x1,z1) and (x2,z2)
 * against non-walkable grid cells (WALL and PILLAR).
 */
export function hasLineOfSight(
  grid,
  width,
  height,
  cellSize,
  x1,
  z1,
  x2,
  z2,
  maxDistance = 24
) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  if (dist > maxDistance) return false;
  if (dist < 0.2) return true;

  const stepSize = cellSize * 0.22;
  const steps = Math.ceil(dist / stepSize);
  const stepX = dx / steps;
  const stepZ = dz / steps;

  for (let i = 1; i < steps; i++) {
    const wx = x1 + stepX * i;
    const wz = z1 + stepZ * i;
    const gx = Math.round(wx / cellSize);
    const gz = Math.round(wz / cellSize);

    if (gx < 0 || gx >= width || gz < 0 || gz >= height) {
      return false;
    }
    if (!isWalkableCell(grid[gz * width + gx])) {
      return false;
    }
  }
  return true;
}
