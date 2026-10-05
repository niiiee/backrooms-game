# Backrooms: Procedural Analog Horror (`< 1 MB` Build)

A complete first-person 3D **Backrooms** survival horror game built from scratch with **Vite + Three.js (Vanilla ES Modules)**.
100% procedural — **zero external 3D models, image textures, or audio files**. Every texture, material, architectural layout, entity mesh, shader, and sound effect is synthesized in real time via code.

## Features
- **6 Distinct Procedural Levels** (loaded on demand with BFS reachability guarantee):
  - **Level 0 — The Lobby**: Mono-yellow wallpaper rooms, damp carpet, buzzing fluorescent ballast tubes, breaker switch puzzles.
  - **Level 1 — Habitable Zone**: Dark concrete warehouse, industrial pillars, periodic blackout cycles, backup generators.
  - **Level 2 — Pipe Dreams**: Claustrophobic utility tunnels, scalding steam leaks, pressure relief valves.
  - **Level 3 — The Poolrooms**: Submerged cyan tile chambers, water drag & loud splash acoustics, drainage pumps.
  - **Level 4 — Abandoned Office**: Cubicle labyrinth, psychological sanity drain, Almond Water dispensers.
  - **Level 5 — The Endless Hallway**: Crimson hotel corridor, false mimic doors, lockdown alarm sprint.
- **3 Distinct AI Entities** (`Howler`, `Smiler`, `Hound`):
  - Grid A* pathfinding, DDA line-of-sight raycasting, acoustic hearing radius, and `PATROL → INVESTIGATE → WARNING → CHASE → SEARCH` state machine.
  - Custom GLSL vertex/fragment distortion aura and directional stereo Web Audio vocalizations.
- **100% Procedural Audio & Visuals**:
  - Web Audio API synthesizer: 60Hz fluorescent hum, sub-bass tension drone, 5 surface-specific footsteps, ragged breathing, lub-dub proximity heartbeat, and pre-encounter acoustic vacuum.
  - Custom GLSL VHS Analog Horror post-processing shader (chromatic aberration, scanlines, tape tracking glitches, grain, vignette, and proximity distortion).

## Controls
- **Move**: `W A S D` or Arrow Keys
- **Look**: Mouse (Click canvas to lock pointer)
- **Sprint**: `Shift`
- **Flashlight**: `F`, `L`, or `Right-Click`
- **Interact**: `E`
- **Pause / Settings**: `Esc` or `P`

## Quick Start
```bash
npm install
npm run dev
```

## Build & Verification
```bash
npm run build
npm test
npm run qa
```
