/**
 * Dynamic on-demand Level Loader.
 * Loads level modules (level0..level5) on demand via ES dynamic import().
 */
const LEVEL_MODULES = {
  0: () => import('./level0.js'),
  1: () => import('./level1.js'),
  2: () => import('./level2.js'),
  3: () => import('./level3.js'),
  4: () => import('./level4.js'),
  5: () => import('./level5.js')
};

export const TOTAL_LEVELS = 6;

export async function loadLevelModule(levelIndex, scene, state, rendererManager, quality) {
  const clampedIndex = Math.max(0, Math.min(TOTAL_LEVELS - 1, levelIndex));
  const loader = LEVEL_MODULES[clampedIndex] || LEVEL_MODULES[0];
  const mod = await loader();
  return mod.createLevel(scene, state, rendererManager, quality);
}
