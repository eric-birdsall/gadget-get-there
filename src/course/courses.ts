import { ascent } from './ascent';
import { crossing } from './crossing';
import { gauntlet } from './gauntlet';
import type { CourseDefinition } from './types';

/** Every level, in the order the level selector lists them. */
export const COURSES: readonly CourseDefinition[] = [crossing, ascent, gauntlet];

/** The level with this id, or the first one. */
export function courseById(id: string): CourseDefinition {
  return COURSES.find((c) => c.id === id) ?? COURSES[0];
}
