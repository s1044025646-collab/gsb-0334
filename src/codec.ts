import {readFileSync, writeFileSync} from 'node:fs';
import {AppError} from './errors.js';
import {validateDimensions, validatePattern, validateSamples} from './mosaic.js';
import type {PatternName} from './patterns.js';
import type {Reconstruction} from './demosaic.js';

export interface ParsedFile {
  width: number;
  height: number;
  pattern: PatternName;
  samples: number[];
}

// JSON：{"width","height","pattern","samples":[...]}
export function parseJsonFile(path: string): ParsedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new AppError('E_PARSE', `JSON 解析失败: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError('E_PARSE', 'JSON 根必须是对象');
  }
  const obj = parsed as Record<string, unknown>;
  const {width, height} = validateDimensions(obj.width, obj.height);
  const pattern = validatePattern(obj.pattern);
  return {width, height, pattern, samples: validateSamples(obj.samples, width * height)};
}

// CSV：首行 # width,height,pattern；其后每行 row,col,value
// 或首行 meta,width,height,pattern。这里采用显式注释头：
//   # width=4 height=3 pattern=RGGB
export function parseCsvFile(path: string): ParsedFile {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const header = lines[0];
  if (!header || !header.startsWith('#')) {
    throw new AppError('E_PARSE', 'CSV 首行必须是 "# width=W height=H pattern=P"');
  }
  const wMatch = /width=(\d+)/.exec(header);
  const hMatch = /height=(\d+)/.exec(header);
  const pMatch = /pattern=([A-Z]{4})/.exec(header);
  if (!wMatch || !hMatch || !pMatch) {
    throw new AppError('E_PARSE', 'CSV 头缺少 width/height/pattern');
  }
  const {width, height} = validateDimensions(Number(wMatch[1]), Number(hMatch[1]));
  const pattern = validatePattern(pMatch[1]);
  const samples: number[] = new Array<number>(width * height).fill(NaN);
  let filled = 0;
  for (const line of lines.slice(1)) {
    const parts = line.split(',').map((x) => x.trim());
    if (parts.length !== 3) throw new AppError('E_PARSE', `CSV 数据行格式错误: ${line}`);
    const row = Number(parts[0]);
    const col = Number(parts[1]);
    const value = Number(parts[2]);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= height || col < 0 || col >= width) {
      throw new AppError('E_PARSE', `CSV 坐标非法: ${line}`);
    }
    if (!Number.isFinite(value)) throw new AppError('E_NON_FINITE', `CSV 值非有限数: ${line}`);
    if (value < 0 || value > 1) throw new AppError('E_RANGE', `CSV 值超出 [0,1]: ${line}`);
    const idx = row * width + col;
    if (Number.isFinite(samples[idx])) throw new AppError('E_PARSE', `CSV 重复坐标: ${line}`);
    samples[idx] = value;
    filled++;
  }
  if (filled !== width * height) {
    throw new AppError('E_SAMPLE_COUNT', `CSV 样本不足：${filled}/${width * height}`);
  }
  return {width, height, pattern, samples};
}

export function parseFixtureFile(path: string): ParsedFile {
  return path.toLowerCase().endsWith('.csv') ? parseCsvFile(path) : parseJsonFile(path);
}

// 导出稠密矩阵 CSV：每行一个像素 row,col,R,G,B
export function exportRgbCsv(rec: Reconstruction, path: string): void {
  const lines: string[] = ['row,col,R,G,B'];
  for (let r = 0; r < rec.height; r++) {
    for (let c = 0; c < rec.width; c++) {
      const idx = r * rec.width + c;
      lines.push(
        [r, c, rec.rgb.R[idx]!, rec.rgb.G[idx]!, rec.rgb.B[idx]!]
          .map((v) => (typeof v === 'number' ? formatNum(v) : String(v)))
          .join(','),
      );
    }
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

// 导出含来源的 JSON
export function exportProvenanceJson(
  rec: Reconstruction,
  path: string,
  offset = 0,
  limit = rec.pixels.length,
): number {
  const slice = rec.pixels.slice(offset, offset + limit);
  writeFileSync(path, JSON.stringify({boundaryRule: rec.boundaryRule, pixels: slice}, null, 2), 'utf8');
  return slice.length;
}

function formatNum(v: number): string {
  // 保留浮点，不做 gamma；足够精度即可
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
