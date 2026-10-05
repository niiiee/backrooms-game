import * as THREE from 'three';
import { CELL } from './validator.js';
import { getProceduralTextures } from './textures.js';
import { SeededRNG } from './rng.js';

export const CHUNK_CELLS = 8; // 8x8 cells per chunk (32m x 32m)

/**
 * Chunked InstancedMesh Level Manager.
 * Splits the procedural level grid into spatial chunks, builds InstancedMeshes
 * per chunk with computed bounding spheres for hardware frustum culling,
 * renders orienting Landmarks, uncanny "Wrong" details, and Storytelling Props,
 * and manages pooled patterned-flickering PointLights with area color variation.
 */
export class ChunkManager {
  constructor(scene, levelData, themeConfig = {}, quality = 'Medium') {
    this.scene = scene;
    this.levelData = levelData;
    this.themeConfig = themeConfig;
    this.quality = quality;

    if (themeConfig.wallHeight) {
      this.levelData.wallHeight = themeConfig.wallHeight;
    }

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = `LevelRoot_${levelData.levelIndex}`;
    this.scene.add(this.rootGroup);

    this.chunks = new Map();
    this.interactiveMeshes = [];
    this.hazardVisuals = [];
    this.landmarkVisuals = [];
    this.exitMesh = null;
    this.exitLight = null;

    this.activeChunkCount = 0;
    this.totalChunkCount = 0;
    this.renderChunkRadius = quality === 'Low' ? 2 : quality === 'High' ? 3 : 2.25;

    this.textures = getProceduralTextures(
      themeConfig.textureTheme || `level${levelData.levelIndex}`,
      levelData.seed
    );

    this.materials = this._createMaterials();
    this.geometries = this._createGeometries();
    this.lightPool = [];
    this.assignedLightFixtures = [];
    this.lightSortTimer = 0;

    this._buildChunks();
    this._buildSpecialObjects();
    this._buildLandmarksAnomaliesAndProps();
    this._initLightPool();
  }

  _createMaterials() {
    const tc = this.themeConfig;
    const useBump = this.quality === 'High';
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.wall,
      roughness: tc.wallRoughness ?? 0.85,
      metalness: tc.wallMetalness ?? 0.08,
      bumpMap: useBump ? this.textures.wall : null,
      bumpScale: 0.032
    });

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.floor,
      roughness: tc.floorRoughness ?? 0.9,
      metalness: tc.floorMetalness ?? 0.05,
      bumpMap: useBump ? this.textures.floor : null,
      bumpScale: 0.026
    });

    const ceilingMat = new THREE.MeshStandardMaterial({
      map: this.textures.ceiling,
      roughness: 0.9,
      metalness: 0.05
    });

    const pillarMat = new THREE.MeshStandardMaterial({
      map: this.textures.wall,
      roughness: 0.82,
      metalness: 0.1,
      color: new THREE.Color(tc.pillarTint ?? 0xd8d0b8)
    });

    const lightFixtureMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tc.lightColor ?? 0xfff6cc),
      emissive: new THREE.Color(tc.lightColor ?? 0xffe89e),
      emissiveIntensity: 1.5,
      roughness: 0.3
    });

    const pipeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tc.propColor ?? 0x5c4028),
      roughness: 0.45,
      metalness: 0.65
    });

    const markingMat = new THREE.MeshStandardMaterial({
      map: this.textures.wallMarking,
      roughness: 0.88,
      metalness: 0.05
    });

    return {
      wallMat,
      floorMat,
      ceilingMat,
      pillarMat,
      lightFixtureMat,
      pipeMat,
      markingMat
    };
  }

  _createGeometries() {
    const cs = this.levelData.cellSize;
    const wh = this.levelData.wallHeight;
    const isRoundPillar = this.themeConfig.pillarShape === 'cylinder';
    return {
      wallGeo: new THREE.BoxGeometry(cs, wh, cs),
      floorGeo: new THREE.BoxGeometry(cs, 0.2, cs),
      ceilingGeo: new THREE.BoxGeometry(cs, 0.2, cs),
      pillarGeo: isRoundPillar
        ? new THREE.CylinderGeometry(cs * 0.28, cs * 0.28, wh, 12)
        : new THREE.BoxGeometry(cs * 0.56, wh, cs * 0.56),
      lightGeo: new THREE.BoxGeometry(1.3, 0.08, 0.65),
      pipeGeo: new THREE.CylinderGeometry(0.14, 0.14, cs, 8)
    };
  }

  _isVisibleWall(x, z) {
    const { grid, width, height } = this.levelData;
    if (grid[z * width + x] !== CELL.WALL) return false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx >= 0 && nx < width && nz >= 0 && nz < height) {
          if (grid[nz * width + nx] !== CELL.WALL) return true;
        }
      }
    }
    return false;
  }

  _buildChunks() {
    const { width, height, grid, roomMap, cellSize, wallHeight, seed, lightFixtures } =
      this.levelData;
    const rng = new SeededRNG(`${seed}-chunks`);
    const chunksX = Math.ceil(width / CHUNK_CELLS);
    const chunksZ = Math.ceil(height / CHUNK_CELLS);

    // Index light fixtures by cell coordinate so ceiling panels reflect broken/colored zones
    const fixtureByCoord = new Map();
    if (lightFixtures) {
      for (const lf of lightFixtures) {
        fixtureByCoord.set(`${lf.x},${lf.z}`, lf);
      }
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const isHigh = this.quality === 'High';

    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const startX = cx * CHUNK_CELLS;
        const endX = Math.min(width, startX + CHUNK_CELLS);
        const startZ = cz * CHUNK_CELLS;
        const endZ = Math.min(height, startZ + CHUNK_CELLS);

        const wallCells = [];
        const floorCells = [];
        const pillarCells = [];
        const lightCells = [];
        const propCells = [];

        for (let z = startZ; z < endZ; z++) {
          for (let x = startX; x < endX; x++) {
            const c = grid[z * width + x];
            if (c === CELL.WALL) {
              if (this._isVisibleWall(x, z)) {
                wallCells.push({ x, z });
              }
            } else {
              floorCells.push({ x, z, cellType: c });
              if (c === CELL.PILLAR) {
                pillarCells.push({ x, z });
              }
              if (x % 2 === 1 && z % 2 === 1 && c !== CELL.PILLAR) {
                lightCells.push({ x, z });
              }
              if ((x + z) % 2 === 0 && c === CELL.CORRIDOR) {
                propCells.push({ x, z });
              }
            }
          }
        }

        if (wallCells.length === 0 && floorCells.length === 0) continue;

        const chunkGroup = new THREE.Group();
        chunkGroup.name = `Chunk_${cx}_${cz}`;

        // 1. Walls InstancedMesh with subtle spatial & room-based tinting
        if (wallCells.length > 0) {
          const wallInst = new THREE.InstancedMesh(
            this.geometries.wallGeo,
            this.materials.wallMat,
            wallCells.length
          );
          wallInst.receiveShadow = isHigh;
          wallInst.castShadow = isHigh;

          wallCells.forEach((cell, i) => {
            dummy.position.set(cell.x * cellSize, wallHeight * 0.5, cell.z * cellSize);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            wallInst.setMatrixAt(i, dummy.matrix);

            const spatialNoise = rng.fbm2D(cell.x * 0.18, cell.z * 0.18, 2);
            const shade = 0.78 + spatialNoise * 0.28;
            color.setRGB(
              shade * rng.range(0.96, 1.03),
              shade * rng.range(0.95, 1.01),
              shade * rng.range(0.91, 1.0)
            );
            wallInst.setColorAt(i, color);
          });
          wallInst.instanceMatrix.needsUpdate = true;
          if (wallInst.instanceColor) wallInst.instanceColor.needsUpdate = true;
          wallInst.computeBoundingSphere();
          chunkGroup.add(wallInst);
        }

        // 2. Floors & Ceilings InstancedMesh (with room-specific wear variation)
        if (floorCells.length > 0) {
          const floorInst = new THREE.InstancedMesh(
            this.geometries.floorGeo,
            this.materials.floorMat,
            floorCells.length
          );
          floorInst.receiveShadow = isHigh;

          const ceilInst = new THREE.InstancedMesh(
            this.geometries.ceilingGeo,
            this.materials.ceilingMat,
            floorCells.length
          );

          floorCells.forEach((cell, i) => {
            dummy.position.set(cell.x * cellSize, -0.1, cell.z * cellSize);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            floorInst.setMatrixAt(i, dummy.matrix);

            dummy.position.set(cell.x * cellSize, wallHeight + 0.1, cell.z * cellSize);
            dummy.updateMatrix();
            ceilInst.setMatrixAt(i, dummy.matrix);

            const rId = roomMap ? roomMap[cell.z * width + cell.x] : -1;
            const roomBias = rId >= 0 ? ((rId * 17) % 10) * 0.012 - 0.05 : 0;
            const fShade = Math.max(0.72, Math.min(1.08, rng.range(0.84, 1.04) + roomBias));
            color.setRGB(fShade, fShade * (cell.cellType === CELL.LARGE_HALL ? 1.02 : 0.99), fShade * 0.97);
            floorInst.setColorAt(i, color);
            ceilInst.setColorAt(i, color);
          });

          floorInst.instanceMatrix.needsUpdate = true;
          if (floorInst.instanceColor) floorInst.instanceColor.needsUpdate = true;
          floorInst.computeBoundingSphere();

          ceilInst.instanceMatrix.needsUpdate = true;
          if (ceilInst.instanceColor) ceilInst.instanceColor.needsUpdate = true;
          ceilInst.computeBoundingSphere();

          chunkGroup.add(floorInst, ceilInst);
        }

        // 3. Structural Pillars InstancedMesh
        if (pillarCells.length > 0) {
          const pillarInst = new THREE.InstancedMesh(
            this.geometries.pillarGeo,
            this.materials.pillarMat,
            pillarCells.length
          );
          pillarInst.castShadow = isHigh;
          pillarInst.receiveShadow = isHigh;

          pillarCells.forEach((cell, i) => {
            dummy.position.set(cell.x * cellSize, wallHeight * 0.5, cell.z * cellSize);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            pillarInst.setMatrixAt(i, dummy.matrix);
          });
          pillarInst.instanceMatrix.needsUpdate = true;
          pillarInst.computeBoundingSphere();
          chunkGroup.add(pillarInst);
        }

        // 4. Ceiling Fluorescent Light Fixtures InstancedMesh (reflects broken/dark/colored zones)
        if (lightCells.length > 0) {
          const lightInst = new THREE.InstancedMesh(
            this.geometries.lightGeo,
            this.materials.lightFixtureMat,
            lightCells.length
          );
          lightCells.forEach((cell, i) => {
            dummy.position.set(cell.x * cellSize, wallHeight - 0.05, cell.z * cellSize);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            lightInst.setMatrixAt(i, dummy.matrix);

            const lf = fixtureByCoord.get(`${cell.x},${cell.z}`);
            if (lf && lf.mode === 'broken') {
              color.setHex(0x1b1b18);
            } else if (lf && lf.colorShift === 'dark_emergency') {
              color.setHex(0xff5533);
            } else if (lf && lf.colorShift === 'sickly_tint') {
              color.setHex(0xc8ffaa);
            } else if (lf && lf.colorShift === 'hall_tint') {
              color.setHex(0xd8f8ff);
            } else {
              color.setHex(0xffffff);
            }
            lightInst.setColorAt(i, color);
          });
          lightInst.instanceMatrix.needsUpdate = true;
          if (lightInst.instanceColor) lightInst.instanceColor.needsUpdate = true;
          lightInst.computeBoundingSphere();
          chunkGroup.add(lightInst);
        }

        // 5. Level-specific Architectural Trim / Overhead Conduits
        if (propCells.length > 0 && this.themeConfig.hasOverheadPipes) {
          const pipeInst = new THREE.InstancedMesh(
            this.geometries.pipeGeo,
            this.materials.pipeMat,
            propCells.length
          );
          propCells.forEach((cell, i) => {
            dummy.position.set(cell.x * cellSize + 1.2, wallHeight - 0.45, cell.z * cellSize);
            dummy.rotation.set(Math.PI * 0.5, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            pipeInst.setMatrixAt(i, dummy.matrix);
          });
          pipeInst.instanceMatrix.needsUpdate = true;
          pipeInst.computeBoundingSphere();
          chunkGroup.add(pipeInst);
        }

        const key = `${cx},${cz}`;
        this.chunks.set(key, {
          cx,
          cz,
          centerX: (startX + (endX - startX) * 0.5) * cellSize,
          centerZ: (startZ + (endZ - startZ) * 0.5) * cellSize,
          group: chunkGroup
        });
        this.rootGroup.add(chunkGroup);
      }
    }

    this.totalChunkCount = this.chunks.size;
  }

  _buildSpecialObjects() {
    const { exit, objectives, hazards, cellSize, wallHeight } = this.levelData;

    // 1. Exit Door + Beacon Light
    const exitGroup = new THREE.Group();
    exitGroup.position.set(exit.x * cellSize, 0, exit.z * cellSize);

    const doorGeo = new THREE.BoxGeometry(1.8, 2.8, 0.35);
    const doorMat = new THREE.MeshStandardMaterial({
      map: this.textures.exitDoor,
      roughness: 0.5,
      metalness: 0.4,
      emissive: new THREE.Color(0x330808),
      emissiveIntensity: 0.7
    });
    const doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.y = 1.4;
    exitGroup.add(doorMesh);

    const signGeo = new THREE.BoxGeometry(0.9, 0.3, 0.2);
    const signMat = new THREE.MeshStandardMaterial({
      color: 0xff3b30,
      emissive: 0xff2211,
      emissiveIntensity: 2.2
    });
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.y = 3.05;
    exitGroup.add(signMesh);

    this.exitLight = new THREE.PointLight(0xff3322, 2.2, 12, 1.5);
    this.exitLight.position.set(0, 3.1, 0);
    exitGroup.add(this.exitLight);

    this.rootGroup.add(exitGroup);
    this.exitMesh = exitGroup;
    this.exitSignMat = signMat;

    // 2. Interactive Objectives
    const objLabel = this.themeConfig.objectiveLabel || 'Breaker Switch';
    const pedestalGeo = new THREE.BoxGeometry(0.65, 1.45, 0.65);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: this.themeConfig.objectiveColor ?? 0x3b4d54,
      roughness: 0.4,
      metalness: 0.65
    });
    const indicatorGeo = new THREE.SphereGeometry(0.18, 12, 12);

    objectives.forEach((obj) => {
      const group = new THREE.Group();
      group.position.set(obj.x * cellSize, 0, obj.z * cellSize);

      const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
      pedestal.position.y = 0.725;
      group.add(pedestal);

      const indicatorMat = new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        emissive: 0xff8800,
        emissiveIntensity: 2.0
      });
      const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
      indicator.position.y = 1.65;
      group.add(indicator);

      this.rootGroup.add(group);
      this.interactiveMeshes.push({
        data: obj,
        label: objLabel,
        group,
        indicatorMat
      });
    });

    // 3. Level Hazards
    const ringGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.12, 12);
    const plumeGeo = new THREE.CylinderGeometry(0.45, 0.75, wallHeight * 0.75, 10, 1, true);

    hazards.forEach((haz) => {
      const hazGroup = new THREE.Group();
      hazGroup.position.set(haz.x * cellSize, 0, haz.z * cellSize);

      const ringMat = new THREE.MeshStandardMaterial({
        color: this.themeConfig.hazardColor ?? 0x775522,
        emissive: this.themeConfig.hazardEmissive ?? 0x331100,
        emissiveIntensity: 0.8,
        roughness: 0.6
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.06;
      hazGroup.add(ring);

      const plumeMat = new THREE.MeshBasicMaterial({
        color: this.themeConfig.hazardPlumeColor ?? 0xd8d8d0,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const plume = new THREE.Mesh(plumeGeo, plumeMat);
      plume.position.y = wallHeight * 0.38;
      hazGroup.add(plume);

      this.rootGroup.add(hazGroup);
      this.hazardVisuals.push({
        data: haz,
        group: hazGroup,
        ringMat,
        plume,
        plumeMat,
        active: true,
        warning: false
      });
    });
  }

  /**
   * Builds orienting architectural Landmarks, unsettling "Wrong" details,
   * and code-built Environmental Storytelling Props.
   */
  _buildLandmarksAnomaliesAndProps() {
    const {
      landmarks = [],
      anomalies = [],
      storyProps = [],
      cellSize,
      wallHeight
    } = this.levelData;

    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e2224,
      roughness: 0.42,
      metalness: 0.75
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x543d26,
      roughness: 0.82
    });
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xd8cfa8,
      roughness: 0.9
    });
    const anomalyDoorMat = new THREE.MeshStandardMaterial({
      map: this.textures.exitDoor,
      color: 0x886666,
      roughness: 0.65
    });

    // A. Orienting Landmarks (Distinct visual beacons in major halls/rooms)
    const sectorColors = [0x4cc9f0, 0xf77f00, 0x80ed99, 0xc77dff];
    landmarks.forEach((lm, idx) => {
      const lmGroup = new THREE.Group();
      lmGroup.position.set(lm.x * cellSize, 0, lm.z * cellSize);
      const beaconColor = sectorColors[idx % sectorColors.length];
      const glowMat = new THREE.MeshStandardMaterial({
        color: beaconColor,
        emissive: beaconColor,
        emissiveIntensity: 1.8,
        roughness: 0.25
      });

      if (lm.type === 'obelisk_monolith') {
        const obelisk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.36, wallHeight * 0.78, 6),
          darkMetalMat
        );
        obelisk.position.y = wallHeight * 0.39;
        lmGroup.add(obelisk);

        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.045, 8, 20), glowMat);
        halo.position.y = wallHeight * 0.56;
        halo.rotation.x = Math.PI * 0.35;
        lmGroup.add(halo);
        this.landmarkVisuals.push({ mesh: halo, spinSpeed: 1.2 });
      } else if (lm.type === 'sunken_basin') {
        const curb = new THREE.Mesh(
          new THREE.TorusGeometry(1.15, 0.12, 6, 16),
          darkMetalMat
        );
        curb.rotation.x = Math.PI * 0.5;
        curb.position.y = 0.08;
        lmGroup.add(curb);

        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), glowMat);
        core.position.y = 1.15;
        lmGroup.add(core);
        this.landmarkVisuals.push({ mesh: core, spinSpeed: -1.6, floatBase: 1.15 });
      } else if (lm.type === 'checkpoint_arch') {
        const postGeo = new THREE.BoxGeometry(0.22, wallHeight * 0.85, 0.22);
        const postL = new THREE.Mesh(postGeo, darkMetalMat);
        postL.position.set(-1.35, wallHeight * 0.425, 0);
        const postR = new THREE.Mesh(postGeo, darkMetalMat);
        postR.position.set(1.35, wallHeight * 0.425, 0);
        const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.24, 0.28), glowMat);
        crossbar.position.set(0, wallHeight * 0.82, 0);
        lmGroup.add(postL, postR, crossbar);
      } else {
        // sector_totem
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.48, 2.2, 0.48), darkMetalMat);
        base.position.y = 1.1;
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.28, 0.54), glowMat);
        band.position.y = 1.85;
        lmGroup.add(base, band);
      }

      this.rootGroup.add(lmGroup);
    });

    // B. Uncanny "Wrong" Architectural Details (misplaced doors, ceiling furniture)
    const wallOffset = cellSize * 0.5 - 0.08;
    anomalies.forEach((anom) => {
      const ag = new THREE.Group();
      const wx = anom.x * cellSize + (anom.wallDx || 0) * wallOffset;
      const wz = anom.z * cellSize + (anom.wallDz || 0) * wallOffset;

      if (anom.type === 'high_door') {
        // Door mounted unnaturally high up on a wall with no stairs
        ag.position.set(wx, Math.min(wallHeight - 0.85, 2.25), wz);
        ag.rotation.y = anom.yaw || 0;
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.55, 0.12), anomalyDoorMat);
        ag.add(door);
      } else if (anom.type === 'ceiling_door') {
        // Door embedded flat in the ceiling looking down
        ag.position.set(anom.x * cellSize, wallHeight - 0.06, anom.z * cellSize);
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 2.1), anomalyDoorMat);
        ag.add(door);
      } else if (anom.type === 'false_door') {
        // Sealed doorway with an eerie red light seam leaking around the frame
        ag.position.set(wx, 1.25, wz);
        ag.rotation.y = anom.yaw || 0;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 0.1), anomalyDoorMat);
        const seamMat = new THREE.MeshBasicMaterial({ color: 0xff2211 });
        const seam = new THREE.Mesh(new THREE.BoxGeometry(1.36, 2.46, 0.04), seamMat);
        ag.add(seam, frame);
      } else if (anom.type === 'upside_down_chair') {
        // Chair stuck upside-down to the ceiling
        ag.position.set(anom.x * cellSize, wallHeight - 0.05, anom.z * cellSize);
        ag.rotation.x = Math.PI;
        ag.rotation.y = anom.yaw || 0;
        ag.add(this._createChairMesh(woodMat));
      }

      this.rootGroup.add(ag);
    });

    // C. Environmental Storytelling Props (markings, abandoned camps, scattered papers, shelves)
    storyProps.forEach((prop) => {
      const pg = new THREE.Group();
      if (prop.type === 'wall_markings') {
        const wx = prop.x * cellSize + (prop.wallDx || 0) * (cellSize * 0.5 - 0.03);
        const wz = prop.z * cellSize + (prop.wallDz || 0) * (cellSize * 0.5 - 0.03);
        pg.position.set(wx, 1.55, wz);
        pg.rotation.y = Math.atan2(-(prop.wallDx || 0), -(prop.wallDz || 1));
        const decal = new THREE.Mesh(
          new THREE.PlaneGeometry(1.35, 1.35),
          this.materials.markingMat
        );
        pg.add(decal);
      } else if (prop.type === 'abandoned_camp') {
        pg.position.set(prop.x * cellSize + 0.6, 0, prop.z * cellSize - 0.5);
        pg.rotation.y = prop.yaw || 0;

        // Toppled chair
        const chair = this._createChairMesh(woodMat);
        chair.rotation.z = Math.PI * 0.46;
        chair.position.set(-0.35, 0.24, 0);
        pg.add(chair);

        // Supply box + dropped glowing flashlight
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.36, 0.42), woodMat);
        box.position.set(0.32, 0.18, 0.25);
        const torchBody = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.05, 0.26, 8),
          darkMetalMat
        );
        torchBody.rotation.z = Math.PI * 0.5;
        torchBody.position.set(0.1, 0.05, -0.25);
        const lensMat = new THREE.MeshBasicMaterial({ color: 0xffe680 });
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 6), lensMat);
        lens.position.set(0.23, 0.05, -0.25);
        pg.add(box, torchBody, lens);
      } else if (prop.type === 'scattered_papers') {
        pg.position.set(prop.x * cellSize, 0.015, prop.z * cellSize);
        const pageGeo = new THREE.PlaneGeometry(0.32, 0.42);
        for (let i = 0; i < 4; i++) {
          const page = new THREE.Mesh(pageGeo, paperMat);
          page.rotation.x = -Math.PI * 0.5;
          page.rotation.z = (i * 1.15) + (prop.yaw || 0);
          page.position.set(
            Math.cos(i * 1.7) * 0.48,
            0.004 * i,
            Math.sin(i * 1.7) * 0.48
          );
          pg.add(page);
        }
      } else if (prop.type === 'toppled_shelf') {
        pg.position.set(prop.x * cellSize - 0.85, 0, prop.z * cellSize + 0.85);
        pg.rotation.y = prop.yaw || 0;
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.65, 0.36), darkMetalMat);
        rack.position.y = 0.72;
        rack.rotation.z = 0.28;
        pg.add(rack);
      }

      this.rootGroup.add(pg);
    });
  }

  _createChairMesh(mat) {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), mat);
    seat.position.y = 0.44;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.06), mat);
    back.position.set(0, 0.72, -0.2);
    chair.add(seat, back);

    const legGeo = new THREE.BoxGeometry(0.05, 0.44, 0.05);
    const offsets = [
      [-0.19, 0.22, -0.19],
      [0.19, 0.22, -0.19],
      [-0.19, 0.22, 0.19],
      [0.19, 0.22, 0.19]
    ];
    for (const [lx, ly, lz] of offsets) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx, ly, lz);
      chair.add(leg);
    }
    return chair;
  }

  _initLightPool() {
    const count = this.quality === 'Low' ? 3 : this.quality === 'High' ? 7 : 5;
    const lightColor = this.themeConfig.lightColor ?? 0xfff2b2;
    const baseIntensity = this.themeConfig.lightIntensity ?? 2.2;

    for (let i = 0; i < count; i++) {
      const pt = new THREE.PointLight(lightColor, baseIntensity, 16, 1.6);
      pt.castShadow = false;
      this.rootGroup.add(pt);
      this.lightPool.push({
        light: pt,
        baseIntensity,
        defaultColorHex: lightColor
      });
    }
  }

  _reassignNearestLights(playerPosition) {
    const { lightFixtures } = this.levelData;
    if (!lightFixtures || lightFixtures.length === 0) return;

    const poolLen = this.lightPool.length;
    this.assignedLightFixtures.length = 0;

    for (let p = 0; p < poolLen; p++) {
      let bestLf = null;
      let bestDistSq = 900; // 30m max radius
      for (let i = 0; i < lightFixtures.length; i++) {
        const lf = lightFixtures[i];
        if (lf.mode === 'broken') continue;
        if (this.assignedLightFixtures.includes(lf)) continue;
        const dx = lf.worldX - playerPosition.x;
        const dz = lf.worldZ - playerPosition.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestLf = lf;
        }
      }
      if (bestLf) {
        this.assignedLightFixtures.push(bestLf);
      }
    }
  }

  _evaluateFlickerPattern(pattern, elapsedTime, seed) {
    const t = elapsedTime + seed;
    if (pattern === 'morse_sos') {
      const cycle = t % 3.2;
      return Math.sin(cycle * 22.0) > 0.15 ? 1.0 : 0.08;
    }
    if (pattern === 'dying_ballast') {
      const buzz = Math.sin(t * 31.0) * Math.cos(t * 57.0);
      return buzz > 0.1 ? 0.55 : 0.06;
    }
    if (pattern === 'heartbeat_pulse') {
      const beat = t % 1.35;
      if (beat < 0.12 || (beat > 0.24 && beat < 0.36)) return 1.25;
      return 0.28;
    }
    if (pattern === 'double_strobe') {
      const phase = t % 1.8;
      return phase < 0.08 || (phase > 0.16 && phase < 0.24) ? 1.35 : 0.12;
    }
    // Fallback erratic flicker
    const wave = Math.sin(t * 19.0) * Math.cos(t * 43.0);
    return wave > 0.35 ? 0.12 : wave < -0.5 ? 0.45 : 1.0;
  }

  /**
   * Updates chunk visibility around player position, animates landmarks,
   * and drives patterned flickering lights with area color shifts.
   */
  update(playerPosition, elapsedTime, blackoutMultiplier = 1.0) {
    const { cellSize, wallHeight } = this.levelData;
    const maxDistSq = Math.pow(this.renderChunkRadius * CHUNK_CELLS * cellSize, 2);

    let activeCount = 0;
    for (const chunk of this.chunks.values()) {
      const dx = chunk.centerX - playerPosition.x;
      const dz = chunk.centerZ - playerPosition.z;
      const distSq = dx * dx + dz * dz;
      const visible = distSq <= maxDistSq;
      if (chunk.group.visible !== visible) {
        chunk.group.visible = visible;
      }
      if (visible) activeCount++;
    }
    this.activeChunkCount = activeCount;

    // Reassign nearest light fixtures every 0.16s (zero per-frame sort allocations)
    if (elapsedTime >= this.lightSortTimer || this.assignedLightFixtures.length === 0) {
      this.lightSortTimer = elapsedTime + 0.16;
      this._reassignNearestLights(playerPosition);
    }

    for (let i = 0; i < this.lightPool.length; i++) {
      const poolItem = this.lightPool[i];
      const lf = this.assignedLightFixtures[i];
      if (!lf) {
        poolItem.light.intensity = 0;
        continue;
      }
      poolItem.light.position.set(lf.worldX, wallHeight - 0.25, lf.worldZ);

      // Area-based light color variation
      if (lf.colorShift === 'dark_emergency') {
        poolItem.light.color.setHex(0xff5533);
      } else if (lf.colorShift === 'sickly_tint') {
        poolItem.light.color.setHex(0xc8f7a6);
      } else if (lf.colorShift === 'hall_tint') {
        poolItem.light.color.setHex(0xd6f5ff);
      } else if (lf.colorShift === 'exit_proximity') {
        poolItem.light.color.setHex(0xffb870);
      } else {
        poolItem.light.color.setHex(poolItem.defaultColorHex);
      }

      let flicker = 1.0;
      if (lf.mode === 'flicker') {
        flicker = this._evaluateFlickerPattern(lf.pattern, elapsedTime, lf.seed);
      }
      poolItem.light.intensity = poolItem.baseIntensity * flicker * blackoutMultiplier;
    }

    // Animate landmark beacons
    for (const lv of this.landmarkVisuals) {
      lv.mesh.rotation.y = elapsedTime * lv.spinSpeed;
      if (lv.floatBase !== undefined) {
        lv.mesh.position.y = lv.floatBase + Math.sin(elapsedTime * 2.4) * 0.14;
      }
    }

    // Animate hazards with a clear pre-burst warning phase
    for (const hv of this.hazardVisuals) {
      const wave = Math.sin(elapsedTime * 2.2 + hv.data.phase);
      hv.warning = wave > 0.0 && wave <= 0.35;
      hv.active = wave > 0.35;
      hv.plume.visible = hv.active || hv.warning;
      if (hv.active) {
        hv.plumeMat.opacity = 0.28 + (wave - 0.35) * 0.25;
        hv.ringMat.emissiveIntensity = 1.6;
      } else if (hv.warning) {
        hv.plumeMat.opacity = 0.08;
        hv.ringMat.emissiveIntensity = 2.4 * (0.5 + 0.5 * Math.sin(elapsedTime * 28.0));
      } else {
        hv.plumeMat.opacity = 0.0;
        hv.ringMat.emissiveIntensity = 0.3;
      }
      hv.plume.rotation.y = elapsedTime * 1.5;
    }

    return {
      activeChunks: this.activeChunkCount,
      totalChunks: this.totalChunkCount
    };
  }

  setExitUnlocked(unlocked) {
    if (this.exitSignMat) {
      this.exitSignMat.color.setHex(unlocked ? 0x32d74b : 0xff3b30);
      this.exitSignMat.emissive.setHex(unlocked ? 0x22cc44 : 0xff2211);
    }
    if (this.exitLight) {
      this.exitLight.color.setHex(unlocked ? 0x32d74b : 0xff3322);
    }
  }

  /**
   * Complete GPU resource cleanup across all chunks, InstancedMeshes, and special objects.
   */
  dispose() {
    this.scene.remove(this.rootGroup);
    const disposedGeos = new Set();
    const disposedMats = new Set();

    this.rootGroup.traverse((obj) => {
      if (obj.isInstancedMesh && typeof obj.dispose === 'function') {
        obj.dispose();
      }
      if (obj.geometry && !disposedGeos.has(obj.geometry)) {
        disposedGeos.add(obj.geometry);
        obj.geometry.dispose();
      }
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m && !disposedMats.has(m)) {
            disposedMats.add(m);
            m.dispose();
          }
        }
      }
    });

    Object.values(this.geometries).forEach((g) => {
      if (!disposedGeos.has(g)) g.dispose();
    });
    Object.values(this.materials).forEach((m) => {
      if (!disposedMats.has(m)) m.dispose();
    });

    this.chunks.clear();
    this.interactiveMeshes.length = 0;
    this.hazardVisuals.length = 0;
    this.landmarkVisuals.length = 0;
    this.lightPool.length = 0;
    this.assignedLightFixtures.length = 0;
  }
}
