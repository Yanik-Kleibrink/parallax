/**
 * CachedPositions interface represents the structure of cached positions for a given base.
 * It is used to quickly show a usable graph layout when the user opens a base, without having to wait till a full graph layout algorithm completes.
 */
export interface CachedPositions {
  base: string;
  positions: Record<string, { x: number; y: number }>;
}
