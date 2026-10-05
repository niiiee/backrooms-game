import { SeededRNG } from './rng.js';
import { CELL, isWalkableCell, validateLevelGrid } from './validator.js';

export const CELL_SIZE = 4.0; // Each grid cell is 4m x 4m in 3D space
export const WALL_HEIGHT = 3.8;

/**
 * Generates a rich, unsettling Backrooms architectural layout:
 * - Diverse room sizes (narrow closets, square chambers, wide offices, grand halls)
 * - Dense Pillar Fields & colonnade halls
 * - Intentional Dead Ends & multi-path Loops for stealth evasion
 * - "Repeated Rooms" (deja-vu twin chambers with subtle unsettling variations)
 * - Orienting Landmarks (Monolith, Sunken Basin, Checkpoint Arch, Sector Totem)
 * - Uncanny "Wrong" Details (doors high up on walls, ceiling doors, inverted furniture, false doors)
 * - Environmental Storytelling Props (abandoned camps, wall markings/arrows, scattered dossiers, toppled racks)
 * - Patterned flickering lights, dark zones, and area-based light color shifts
 * - Guaranteed reachable Exit & Objectives verified by BFS validator
 */
export function generateLevelArchitecture(config = {}) {
  const {
    levelIndex = 0,
    seed = 'BACKROOMS-0',
    width = 36,
    height = 36,
    hallCount = 3,
    roomCount = 8,
    deadEndCount = 10,
    loopCount = 5,
    pillarDensity = 0.55,
    objectiveCount = 2,
    hazardCount = 4,
    minExitDistance = 20,
    corridorBias = 'standard' // 'standard' | 'tunnels' | 'pools' | 'office' | 'endless_hall'
  } = config;

  const maxAttempts = 25;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed =
      attempt === 0 ? `${seed}-L${levelIndex}` : `${seed}-L${levelIndex}-retry-${attempt}`;
    const rng = new SeededRNG(attemptSeed);

    const grid = new Uint8Array(width * height).fill(CELL.WALL);
    // Optional per-cell zone/room metadata for subtle per-room texture/tint variation
    const roomMap = new Int16Array(width * height).fill(-1);
    const idx = (x, z) => z * width + x;
    const inBounds = (x, z, pad = 1) =>
      x >= pad && x < width - pad && z >= pad && z < height - pad;

    const halls = [];
    const rooms = [];
    const pillars = [];
    const deadEnds = [];
    const doorways = [];
    const featureNodes = [];
    const landmarks = [];
    const anomalies = [];
    const storyProps = [];

    // Helper to carve a rectangular area and tag its room ID
    const carveRect = (rx, rz, rw, rh, cellType, roomId = -1) => {
      for (let z = rz; z < rz + rh; z++) {
        for (let x = rx; x < rx + rw; x++) {
          if (inBounds(x, z, 1)) {
            grid[idx(x, z)] = cellType;
            if (roomId >= 0) {
              roomMap[idx(x, z)] = roomId;
            }
          }
        }
      }
    };

    // Helper to check overlap with padding
    const overlaps = (rx, rz, rw, rh, list, pad = 2) => {
      for (const item of list) {
        if (
          rx - pad < item.x + item.w &&
          rx + rw + pad > item.x &&
          rz - pad < item.z + item.h &&
          rz + rh + pad > item.z
        ) {
          return true;
        }
      }
      return false;
    };

    // 1. Place Starting Room near center-west
    const startRoom = {
      id: 0,
      x: 3,
      z: Math.floor(height / 2) - 2,
      w: 4,
      h: 4,
      cx: 5,
      cz: Math.floor(height / 2),
      type: 'spawn_room',
      tintShade: 1.0
    };
    carveRect(startRoom.x, startRoom.z, startRoom.w, startRoom.h, CELL.ROOM, 0);
    rooms.push(startRoom);
    featureNodes.push({ x: startRoom.cx, z: startRoom.cz, kind: 'room' });

    // 2. Place Large Halls & Pillar Fields
    if (corridorBias === 'endless_hall') {
      const spineZ = Math.floor(height / 2);
      carveRect(4, spineZ - 1, width - 8, 3, CELL.LARGE_HALL, 100);
      halls.push({
        x: 4,
        z: spineZ - 1,
        w: width - 8,
        h: 3,
        cx: Math.floor(width / 2),
        cz: spineZ,
        hallStyle: 'grand_avenue'
      });
      featureNodes.push({ x: Math.floor(width / 2), z: spineZ, kind: 'hall' });
      featureNodes.push({ x: width - 6, z: spineZ, kind: 'hall' });
    }

    for (let i = 0; i < hallCount * 5 && halls.length < hallCount; i++) {
      // Vary hall shapes: wide colonnade, elongated gallery, or dense pillar field
      const hallStyle = rng.pick(['pillar_field', 'colonnade', 'rotunda']);
      const hw = hallStyle === 'colonnade' ? rng.int(8, 11) : rng.int(6, 9);
      const hh = hallStyle === 'colonnade' ? rng.int(5, 7) : rng.int(6, 9);
      const hx = rng.int(4, width - hw - 4);
      const hz = rng.int(4, height - hh - 4);

      if (!overlaps(hx, hz, hw, hh, [...halls, ...rooms], 2)) {
        const hallId = 101 + halls.length;
        carveRect(hx, hz, hw, hh, CELL.LARGE_HALL, hallId);
        const hall = {
          id: hallId,
          x: hx,
          z: hz,
          w: hw,
          h: hh,
          cx: Math.floor(hx + hw / 2),
          cz: Math.floor(hz + hh / 2),
          hallStyle
        };
        halls.push(hall);
        featureNodes.push({ x: hall.cx, z: hall.cz, kind: 'hall' });

        // Place architectural pillar patterns inside the Large Hall
        const effectiveDensity =
          hallStyle === 'pillar_field' ? Math.min(0.88, pillarDensity + 0.25) : pillarDensity;

        for (let pz = hz + 1; pz < hz + hh - 1; pz += 2) {
          for (let px = hx + 1; px < hx + hw - 1; px += 2) {
            // Keep center landmark tile clear
            if (px === hall.cx && pz === hall.cz) continue;
            if (rng.chance(effectiveDensity)) {
              grid[idx(px, pz)] = CELL.PILLAR;
              pillars.push({ x: px, z: pz, inHall: true, hallStyle });
            }
          }
        }
      }
    }

    // 3. Place Varied Rooms + "Repeated Deja-Vu Twin Rooms" with subtle unsettling differences
    const roomArchetypes = [
      { type: 'narrow_storage', wRange: [2, 3], hRange: [5, 6] },
      { type: 'wide_alcove', wRange: [5, 6], hRange: [2, 3] },
      { type: 'square_chamber', wRange: [3, 4], hRange: [3, 4] },
      { type: 'column_room', wRange: [5, 5], hRange: [5, 5] },
      { type: 'partitioned_room', wRange: [4, 6], hRange: [4, 5] }
    ];

    let twinTemplate = null;

    for (let i = 0; i < roomCount * 6 && rooms.length < roomCount + 1; i++) {
      // Every 4th room, try to spawn a "Repeated Room" (deja-vu twin of an earlier room with a slight uncanny change)
      const isTwinAttempt = twinTemplate !== null && rooms.length % 3 === 0 && rng.chance(0.65);
      const arch = isTwinAttempt ? twinTemplate.arch : rng.pick(roomArchetypes);
      const rw = isTwinAttempt ? twinTemplate.w : rng.int(arch.wRange[0], arch.wRange[1]);
      const rh = isTwinAttempt ? twinTemplate.h : rng.int(arch.hRange[0], arch.hRange[1]);
      const rx = rng.int(3, width - rw - 3);
      const rz = rng.int(3, height - rh - 3);

      if (!overlaps(rx, rz, rw, rh, [...halls, ...rooms], 2)) {
        const roomId = rooms.length;
        carveRect(rx, rz, rw, rh, CELL.ROOM, roomId);
        const room = {
          id: roomId,
          x: rx,
          z: rz,
          w: rw,
          h: rh,
          cx: Math.floor(rx + rw / 2),
          cz: Math.floor(rz + rh / 2),
          type: isTwinAttempt ? 'repeated_twin' : arch.type,
          tintShade: rng.range(0.84, 1.06)
        };
        rooms.push(room);
        featureNodes.push({ x: room.cx, z: room.cz, kind: 'room' });

        if (!twinTemplate && rw >= 4 && rh >= 4) {
          twinTemplate = { w: rw, h: rh, arch };
        }

        // Architectural variation inside rooms
        if (room.type === 'column_room' && rw >= 5 && rh >= 5) {
          grid[idx(room.cx + 1, room.cz + 1)] = CELL.PILLAR;
          pillars.push({ x: room.cx + 1, z: room.cz + 1, inHall: false });
        } else if (room.type === 'repeated_twin' && rw >= 4 && rh >= 4) {
          // Subtle "wrong" twin room change: off-center pillar + unsettling anomaly marker
          const px = Math.min(width - 3, room.cx - 1);
          const pz = Math.min(height - 3, room.cz + 1);
          if (px !== room.cx || pz !== room.cz) {
            grid[idx(px, pz)] = CELL.PILLAR;
            pillars.push({ x: px, z: pz, inHall: false, isAnomalyPillar: true });
          }
          anomalies.push({
            type: 'upside_down_chair',
            x: room.cx,
            z: room.cz,
            yaw: rng.range(0, Math.PI * 2)
          });
        }
      }
    }

    // Helper to carve a 1-cell wide corridor between two points (L-shaped)
    const carveCorridor = (x1, z1, x2, z2) => {
      let cx = x1;
      let cz = z1;
      const horizontalFirst = rng.chance(0.5);

      const stepCell = (x, z) => {
        if (!inBounds(x, z, 1)) return;
        const current = grid[idx(x, z)];
        if (current === CELL.WALL) {
          grid[idx(x, z)] = CELL.CORRIDOR;
        } else if (current === CELL.PILLAR) {
          grid[idx(x, z)] = CELL.LARGE_HALL;
        }
      };

      if (horizontalFirst) {
        while (cx !== x2) {
          stepCell(cx, cz);
          cx += cx < x2 ? 1 : -1;
        }
        while (cz !== z2) {
          stepCell(cx, cz);
          cz += cz < z2 ? 1 : -1;
        }
      } else {
        while (cz !== z2) {
          stepCell(cx, cz);
          cz += cz < z2 ? 1 : -1;
        }
        while (cx !== x2) {
          stepCell(cx, cz);
          cx += cx < x2 ? 1 : -1;
        }
      }
      stepCell(x2, z2);
    };

    // 4. Connect all rooms and large halls into a connected spanning network
    for (let i = 1; i < featureNodes.length; i++) {
      let bestPrev = featureNodes[0];
      let bestDist = Infinity;
      for (let j = 0; j < i; j++) {
        const cand = featureNodes[j];
        const d = Math.abs(cand.x - featureNodes[i].x) + Math.abs(cand.z - featureNodes[i].z);
        if (d < bestDist) {
          bestDist = d;
          bestPrev = cand;
        }
      }
      carveCorridor(featureNodes[i].x, featureNodes[i].z, bestPrev.x, bestPrev.z);
    }

    // Add extra loop corridors so the player can juke and evade enemies around blocks
    for (let l = 0; l < loopCount + 2; l++) {
      const a = rng.pick(featureNodes);
      const b = rng.pick(featureNodes);
      if (a && b && a !== b) {
        carveCorridor(a.x, a.z, b.x, b.z);
      }
    }

    // 5. Carve intentional Dead-End spurs off corridors & rooms
    const corridorCells = [];
    for (let z = 2; z < height - 2; z++) {
      for (let x = 2; x < width - 2; x++) {
        if (grid[idx(x, z)] === CELL.CORRIDOR) {
          corridorCells.push({ x, z });
        }
      }
    }
    rng.shuffle(corridorCells);

    const dirs = [
      { dx: 1, dz: 0 },
      { dx: -1, dz: 0 },
      { dx: 0, dz: 1 },
      { dx: 0, dz: -1 }
    ];

    for (const c of corridorCells) {
      if (deadEnds.length >= deadEndCount) break;
      const dir = rng.pick(dirs);
      const spurLen = rng.int(3, 6);
      let canCarve = true;

      for (let s = 1; s <= spurLen; s++) {
        const tx = c.x + dir.dx * s;
        const tz = c.z + dir.dz * s;
        if (!inBounds(tx, tz, 2) || grid[idx(tx, tz)] !== CELL.WALL) {
          canCarve = false;
          break;
        }
        const px1 = tx + dir.dz;
        const pz1 = tz + dir.dx;
        const px2 = tx - dir.dz;
        const pz2 = tz - dir.dx;
        if (grid[idx(px1, pz1)] !== CELL.WALL || grid[idx(px2, pz2)] !== CELL.WALL) {
          canCarve = false;
          break;
        }
      }

      if (canCarve) {
        for (let s = 1; s < spurLen; s++) {
          grid[idx(c.x + dir.dx * s, c.z + dir.dz * s)] = CELL.CORRIDOR;
        }
        const endX = c.x + dir.dx * spurLen;
        const endZ = c.z + dir.dz * spurLen;
        grid[idx(endX, endZ)] = CELL.DEAD_END;
        deadEnds.push({ x: endX, z: endZ, dir });
      }
    }

    // 6. Mark Doorways where corridors meet rooms/halls
    for (let z = 2; z < height - 2; z++) {
      for (let x = 2; x < width - 2; x++) {
        if (grid[idx(x, z)] !== CELL.CORRIDOR) continue;
        let touchesRoom = false;
        for (const d of dirs) {
          const nCell = grid[idx(x + d.dx, z + d.dz)];
          if (nCell === CELL.ROOM || nCell === CELL.LARGE_HALL) {
            touchesRoom = true;
            break;
          }
        }
        if (touchesRoom) {
          grid[idx(x, z)] = CELL.DOORWAY;
          doorways.push({ x, z });
        }
      }
    }

    // 7. Set Spawn and find best distant cell for Exit using BFS flood-fill
    const spawn = { x: startRoom.cx, z: startRoom.cz };
    grid[idx(spawn.x, spawn.z)] = CELL.SPAWN;

    const prelimCheck = validateLevelGrid(grid, width, height, spawn, spawn, [], 0);
    const distMap = prelimCheck.distMap;

    let bestExit = null;
    let bestExitDist = -1;

    for (let z = 2; z < height - 2; z++) {
      for (let x = 2; x < width - 2; x++) {
        const d = distMap[idx(x, z)];
        if (d > bestExitDist && isWalkableCell(grid[idx(x, z)])) {
          const cellType = grid[idx(x, z)];
          const bonus = cellType === CELL.ROOM || cellType === CELL.DEAD_END ? 4 : 0;
          if (d + bonus > bestExitDist) {
            bestExitDist = d;
            bestExit = { x, z };
          }
        }
      }
    }

    if (!bestExit) continue;
    grid[idx(bestExit.x, bestExit.z)] = CELL.EXIT;

    // 8. Place Interactive Objectives (Valves, Breakers, Terminals, Anomaly Seals)
    const objectives = [];
    const candidateObjectiveCells = [
      ...deadEnds.map((de) => ({ x: de.x, z: de.z })),
      ...rooms.slice(1).map((r) => ({ x: r.cx, z: r.cz })),
      ...halls.map((h) => ({ x: h.cx, z: h.cz }))
    ].filter(
      (pt) =>
        (pt.x !== spawn.x || pt.z !== spawn.z) &&
        (pt.x !== bestExit.x || pt.z !== bestExit.z) &&
        distMap[idx(pt.x, pt.z)] >= 6 &&
        isWalkableCell(grid[idx(pt.x, pt.z)])
    );

    rng.shuffle(candidateObjectiveCells);
    for (let i = 0; i < Math.min(objectiveCount, candidateObjectiveCells.length); i++) {
      const objCell = candidateObjectiveCells[i];
      grid[idx(objCell.x, objCell.z)] = CELL.OBJECTIVE;
      objectives.push({
        id: `obj-${i}`,
        x: objCell.x,
        z: objCell.z,
        activated: false
      });
    }

    // 9. Place Level Hazards
    const hazards = [];
    for (let z = 2; z < height - 2; z++) {
      for (let x = 2; x < width - 2; x++) {
        if (hazards.length >= hazardCount) break;
        const cType = grid[idx(x, z)];
        if (
          (cType === CELL.CORRIDOR || cType === CELL.LARGE_HALL) &&
          distMap[idx(x, z)] >= 8 &&
          rng.chance(0.06)
        ) {
          hazards.push({
            id: `haz-${hazards.length}`,
            x,
            z,
            phase: rng.range(0, Math.PI * 2)
          });
        }
      }
    }

    // 10. Validate final grid (Spawn -> Exit + all Objectives reachable)
    const validation = validateLevelGrid(
      grid,
      width,
      height,
      spawn,
      bestExit,
      objectives,
      minExitDistance
    );

    if (!validation.valid || pillars.length === 0 || halls.length === 0 || rooms.length < 2) {
      continue;
    }

    // 11. Place Orienting Landmarks in Halls & Major Rooms (non-blocking visual beacons)
    const landmarkTypes = [
      'obelisk_monolith',
      'sunken_basin',
      'checkpoint_arch',
      'sector_totem'
    ];
    let lmIndex = 0;
    for (const h of halls) {
      // Avoid placing right on top of an objective or exit
      const occupied =
        (h.cx === bestExit.x && h.cz === bestExit.z) ||
        objectives.some((o) => o.x === h.cx && o.z === h.cz);
      const lx = occupied ? Math.min(width - 3, h.cx + 1) : h.cx;
      const lz = h.cz;
      if (isWalkableCell(grid[idx(lx, lz)])) {
        landmarks.push({
          type: landmarkTypes[lmIndex % landmarkTypes.length],
          x: lx,
          z: lz,
          sectorNumber: lmIndex + 1
        });
        lmIndex++;
      }
    }
    if (rooms.length > 2) {
      const midRoom = rooms[Math.floor(rooms.length / 2)];
      if (
        (midRoom.cx !== bestExit.x || midRoom.cz !== bestExit.z) &&
        !objectives.some((o) => o.x === midRoom.cx && o.z === midRoom.cz)
      ) {
        landmarks.push({
          type: 'sector_totem',
          x: midRoom.cx,
          z: midRoom.cz,
          sectorNumber: lmIndex + 1
        });
      }
    }

    // 12. Place Uncanny "Wrong" Architectural Details & Environmental Storytelling Props
    for (let z = 2; z < height - 2; z++) {
      for (let x = 2; x < width - 2; x++) {
        const c = grid[idx(x, z)];
        if (!isWalkableCell(c)) continue;
        if (x === spawn.x && z === spawn.z) continue;
        if (x === bestExit.x && z === bestExit.z) continue;

        // Check if adjacent to a solid wall for wall-mounted anomalies & markings
        let wallDir = null;
        for (const d of dirs) {
          if (grid[idx(x + d.dx, z + d.dz)] === CELL.WALL) {
            wallDir = d;
            break;
          }
        }

        if (wallDir && anomalies.length < 10 && rng.chance(0.032)) {
          const anomalyKind = rng.pick([
            'high_door',
            'ceiling_door',
            'false_door',
            'upside_down_chair'
          ]);
          anomalies.push({
            type: anomalyKind,
            x,
            z,
            wallDx: wallDir.dx,
            wallDz: wallDir.dz,
            yaw: Math.atan2(wallDir.dx, wallDir.dz)
          });
        } else if (wallDir && storyProps.length < 18 && rng.chance(0.055)) {
          const propKind =
            c === CELL.DEAD_END
              ? 'abandoned_camp'
              : rng.pick(['wall_markings', 'scattered_papers', 'toppled_shelf', 'abandoned_camp']);
          storyProps.push({
            type: propKind,
            x,
            z,
            wallDx: wallDir.dx,
            wallDz: wallDir.dz,
            yaw: rng.range(0, Math.PI * 2),
            variant: rng.int(0, 3)
          });
        }
      }
    }

    // 13. Designate 2 Dark Zones & Area Light Color Zones
    const darkZoneCenters = [
      { x: rng.int(6, width - 6), z: rng.int(6, height - 6), radius: 5.5 },
      { x: rng.int(6, width - 6), z: rng.int(6, height - 6), radius: 5.0 }
    ];

    const lightFixtures = [];
    const patrolWaypoints = [];
    const flickerPatterns = ['morse_sos', 'dying_ballast', 'heartbeat_pulse', 'double_strobe'];

    for (let z = 1; z < height - 1; z++) {
      for (let x = 1; x < width - 1; x++) {
        const c = grid[idx(x, z)];
        if (!isWalkableCell(c)) continue;

        if (x % 2 === 1 && z % 2 === 1) {
          const inDarkZone = darkZoneCenters.some(
            (dz) => Math.hypot(x - dz.x, z - dz.z) <= dz.radius && Math.hypot(x - spawn.x, z - spawn.z) > 6
          );
          const distToExit = Math.hypot(x - bestExit.x, z - bestExit.z);
          const modeRoll = rng.next();

          let mode = 'steady';
          let pattern = 'steady';
          if (inDarkZone) {
            mode = modeRoll < 0.72 ? 'broken' : 'flicker';
            pattern = 'dying_ballast';
          } else if (modeRoll < 0.24) {
            mode = 'flicker';
            pattern = rng.pick(flickerPatterns);
          } else if (modeRoll < 0.31) {
            mode = 'broken';
          }

          // Area color variation: warm near spawn, eerie green/cyan in deep halls, emergency amber/red near dark zones or exit
          let colorShift = 'standard';
          if (distToExit < 7.5) {
            colorShift = 'exit_proximity';
          } else if (inDarkZone) {
            colorShift = 'dark_emergency';
          } else if (c === CELL.LARGE_HALL) {
            colorShift = 'hall_tint';
          } else if ((x + z) % 14 === 0) {
            colorShift = 'sickly_tint';
          }

          lightFixtures.push({
            x,
            z,
            worldX: x * CELL_SIZE,
            worldZ: z * CELL_SIZE,
            mode,
            pattern,
            colorShift,
            seed: rng.range(0, 100)
          });
        }

        if (distMap[idx(x, z)] >= 10 && (x + z) % 3 === 0) {
          patrolWaypoints.push({ x, z, distFromSpawn: distMap[idx(x, z)] });
        }
      }
    }

    return {
      levelIndex,
      seed: attemptSeed,
      attemptsUsed: attempt + 1,
      width,
      height,
      cellSize: CELL_SIZE,
      wallHeight: WALL_HEIGHT,
      grid,
      roomMap,
      spawn,
      exit: bestExit,
      halls,
      rooms,
      pillars,
      deadEnds,
      doorways,
      objectives,
      hazards,
      landmarks,
      anomalies,
      storyProps,
      lightFixtures,
      patrolWaypoints,
      validation
    };
  }

  throw new Error(`Failed to generate valid level after ${maxAttempts} attempts for seed ${seed}`);
}

/**
 * Computes distance and player-relative directional bearing to a target cell
 * so the player always has an intuitive, fair orientation cue on the HUD.
 */
export function formatSignalBearing(player, targetCell, cellSize, label = 'Signal') {
  if (!player || !targetCell) return '';
  const tx = targetCell.x * cellSize;
  const tz = targetCell.z * cellSize;
  const dx = tx - player.x;
  const dz = tz - player.z;
  const dist = Math.round(Math.hypot(dx, dz));

  const lookX = -Math.sin(player.yaw || 0);
  const lookZ = -Math.cos(player.yaw || 0);
  const rightX = Math.cos(player.yaw || 0);
  const rightZ = -Math.sin(player.yaw || 0);

  const len = Math.max(0.001, Math.hypot(dx, dz));
  const nx = dx / len;
  const nz = dz / len;

  const forwardDot = nx * lookX + nz * lookZ;
  const rightDot = nx * rightX + nz * rightZ;

  let dirTag = '▲ AHEAD';
  if (forwardDot < -0.45) {
    dirTag = '▼ BEHIND';
  } else if (rightDot > 0.4) {
    dirTag = '▶ RIGHT';
  } else if (rightDot < -0.4) {
    dirTag = '◀ LEFT';
  }

  return `${label}: ${dist}m [${dirTag}]`;
}
