export type Channel = 'R' | 'G' | 'B';
export type PatternName = 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';

export const PATTERN_NAMES: PatternName[] = ['RGGB', 'BGGR', 'GRBG', 'GBRG'];

// 索引 = (row % 2) * 2 + (col % 2)，左上角为原点，沿全图重复，
// 不随行宽奇偶重置相位。例：RGGB 即 2x2 网格 [[R,G],[G,B]]
export const PATTERNS: Record<PatternName, [Channel, Channel, Channel, Channel]> = {
  RGGB: ['R', 'G', 'G', 'B'],
  BGGR: ['B', 'G', 'G', 'R'],
  GRBG: ['G', 'R', 'B', 'G'],
  GBRG: ['G', 'B', 'R', 'G'],
};

export function isPatternName(value: unknown): value is PatternName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PATTERNS, value);
}

export function phaseIndex(row: number, col: number): number {
  return ((row & 1) << 1) | (col & 1);
}

export function channelAt(pattern: PatternName, row: number, col: number): Channel {
  return PATTERNS[pattern][phaseIndex(row, col)];
}

export function patternGrid(pattern: PatternName): Channel[][] {
  const p = PATTERNS[pattern];
  return [
    [p[0], p[1]],
    [p[2], p[3]],
  ];
}
