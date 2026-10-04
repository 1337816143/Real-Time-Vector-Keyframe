import type { PresetId } from './types';

// Face tracking is an explicit selection, never a side effect of carousel/swipe.
export const CYCLE_PRESETS: readonly PresetId[] = ['multiverse', 'cyber', 'dream', 'time', 'freeze', 'slash'];
export function nextCyclePreset(current: PresetId, direction: -1 | 1): PresetId {
  const index = CYCLE_PRESETS.indexOf(current);
  if (index < 0) return direction === 1 ? CYCLE_PRESETS[0] : CYCLE_PRESETS[CYCLE_PRESETS.length - 1];
  return CYCLE_PRESETS[(index + direction + CYCLE_PRESETS.length) % CYCLE_PRESETS.length];
}
