import {channelAt} from './patterns.js';
import type {MosaicSpec} from './mosaic.js';
import type {Reconstruction} from './demosaic.js';

export interface VerifyIssue {
  row: number;
  col: number;
  channel: 'R' | 'G' | 'B';
  kind: 'MEASURED_CHANGED' | 'WRONG_SOURCE_COLOR' | 'BAD_WEIGHT_SUM' | 'NON_FINITE' | 'SOURCE_MISMATCH';
  message: string;
}

export interface VerifyReport {
  ok: boolean;
  issues: VerifyIssue[];
  checked: number;
}

const EPS = 1e-9;

export function verifyReconstruction(spec: MosaicSpec, rec: Reconstruction): VerifyReport {
  const issues: VerifyIssue[] = [];
  let checked = 0;
  for (let r = 0; r < spec.height; r++) {
    for (let c = 0; c < spec.width; c++) {
      const px = rec.pixels[r * spec.width + c]!;
      const own = channelAt(spec.pattern, r, c);
      for (const ch of ['R', 'G', 'B'] as const) {
        checked++;
        const cr = px[ch];
        if (!Number.isFinite(cr.value)) {
          issues.push({row: r, col: c, channel: ch, kind: 'NON_FINITE', message: '输出不是有限数'});
        }
        const sum = cr.sources.reduce((acc, s) => acc + s.weight, 0);
        if (Math.abs(sum - 1) > EPS) {
          issues.push({
            row: r,
            col: c,
            channel: ch,
            kind: 'BAD_WEIGHT_SUM',
            message: `权重和=${sum}，不等于 1`,
          });
        }
        for (const s of cr.sources) {
          if (s.channel !== ch) {
            issues.push({
              row: r,
              col: c,
              channel: ch,
              kind: 'WRONG_SOURCE_COLOR',
              message: `来源 (${s.row},${s.col}) 颜色 ${s.channel} 与所需 ${ch} 不符`,
            });
          }
          const raw = spec.samples[s.row * spec.width + s.col];
          if (raw === undefined || raw !== s.value) {
            issues.push({
              row: r,
              col: c,
              channel: ch,
              kind: 'SOURCE_MISMATCH',
              message: `来源 (${s.row},${s.col}) 原始值不匹配`,
            });
          }
        }
        if (ch === own) {
          const raw = spec.samples[r * spec.width + c]!;
          if (!cr.measured || cr.value !== raw || cr.sources.length !== 1 || cr.sources[0]!.weight !== 1) {
            issues.push({
              row: r,
              col: c,
              channel: ch,
              kind: 'MEASURED_CHANGED',
              message: '实测通道未被原样保留',
            });
          }
        } else if (cr.measured) {
          issues.push({
            row: r,
            col: c,
            channel: ch,
            kind: 'MEASURED_CHANGED',
            message: '非本相位通道被错误标记为实测',
          });
        }
      }
    }
  }
  return {ok: issues.length === 0, issues: issues.slice(0, 500), checked};
}
