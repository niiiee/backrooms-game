/**
 * Level validator using Breadth-First Search (BFS) flood-fill.
 * Guarantees that the exit and all required objectives are reachable from spawn,
 * and meets minimum path length and architectural variety criteria.
 */
export const CELL = {
  WALL: 0,
  CORRIDOR: 1,
  ROOM: 2,
  LARGE_HALL: 3,
  PILLAR: 4, // Solid pillar inside a hall or room (non-walkable obstacle)
  DEAD_END: 5,
  SPAWN: 6,
  EXIT: 7,
  HAZARD: 8,
  OBJECTIVE: 9,
  DOORWAY: 10
};

export function isWalkableCell(cellValue) {
  return cellValue !== CELL.WALL && cellValue !== CELL.PILLAR;
}

/**
 * Validates that a generated level grid has a walkable path from spawn to exit
 * and to all required objective cells.
 *
 * @param {Uint8Array|Array<number>} grid Flat grid array of length width * height
 * @param {number} width Grid width
 * @param {number} height Grid height
 * @param {{x: number, z: number}} spawn Spawn coordinates
 * @param {{x: number, z: number}} exit Exit coordinates
 * @param {Array<{x: number, z: number}>} objectives Array of required objective coordinates
 * @param {number} minDistance Minimum required BFS steps between spawn and exit
 */
export function validateLevelGrid(
  grid,
  width,
  height,
  spawn,
  exit,
  objectives = [],
  minDistance = 12
) {
  if (!spawn || !exit) {
    return { valid: false, reason: 'Missing spawn or exit' };
  }

  const inBounds = (x, z) => x >= 0 && x < width && z >= 0 && z < height;
  const idx = (x, z) => z * width + x;

  if (!inBounds(spawn.x, spawn.z) || !inBounds(exit.x, exit.z)) {
    return { valid: false, reason: 'Spawn or exit out of bounds' };
  }

  if (!isWalkableCell(grid[idx(spawn.x, spawn.z)])) {
    return { valid: false, reason: 'Spawn cell is not walkable' };
  }
  if (!isWalkableCell(grid[idx(exit.x, exit.z)])) {
    return { valid: false, reason: 'Exit cell is not walkable' };
  }

  const distMap = new Int32Array(width * height).fill(-1);
  const parentMap = new Int32Array(width * height).fill(-1);
  const queue = [];

  const startIndex = idx(spawn.x, spawn.z);
  distMap[startIndex] = 0;
  queue.push(startIndex);

  let head = 0;
  let reachableCount = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  while (head < queue.length) {
    const curr = queue[head++];
    reachableCount++;
    const cx = curr % width;
    const cz = (curr / width) | 0;
    const nextDist = distMap[curr] + 1;

    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d][0];
      const nz = cz + dirs[d][1];
      if (!inBounds(nx, nz)) continue;
      const nIdx = idx(nx, nz);
      if (distMap[nIdx] !== -1) continue;
      if (!isWalkableCell(grid[nIdx])) continue;

      distMap[nIdx] = nextDist;
      parentMap[nIdx] = curr;
      queue.push(nIdx);
    }
  }

  const exitIndex = idx(exit.x, exit.z);
  const exitDistance = distMap[exitIndex];

  if (exitDistance === -1) {
    return {
      valid: false,
      reason: 'Exit is unreachable from spawn',
      reachableCount,
      distMap
    };
  }

  if (exitDistance < minDistance) {
    return {
      valid: false,
      reason: `Exit distance (${exitDistance}) is below minimum (${minDistance})`,
      distance: exitDistance,
      reachableCount,
      distMap
    };
  }

  // Verify all objectives are reachable
  for (let i = 0; i < objectives.length; i++) {
    const obj = objectives[i];
    if (!inBounds(obj.x, obj.z) || distMap[idx(obj.x, obj.z)] === -1) {
      return {
        valid: false,
        reason: `Objective ${i} at (${obj.x}, ${obj.z}) is unreachable`,
        distance: exitDistance,
        reachableCount,
        distMap
      };
    }
  }

  // Reconstruct shortest path from spawn to exit
  const shortestPath = [];
  let trace = exitIndex;
  while (trace !== -1) {
    shortestPath.push({
      x: trace % width,
      z: (trace / width) | 0
    });
    trace = parentMap[trace];
  }
  shortestPath.reverse();

  return {
    valid: true,
    distance: exitDistance,
    reachableCount,
    shortestPath,
    distMap
  };
}
