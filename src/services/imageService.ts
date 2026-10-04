import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../core/errors.js";
import { reconstruct, reconstructPixel } from "../core/reconstruct.js";
import type {
  BayerPattern,
  Channel,
  Mosaic,
  MosaicInput,
  PixelProvenance,
  Reconstruction
} from "../core/types.js";
import {
  DEFAULT_MAX_PIXELS,
  assertCoordinate,
  isBayerPattern,
  paginate,
  parseMosaicInput,
  phaseAt
} from "../core/validation.js";

interface VersionRow {
  image_id: string;
  version: number;
  created_at: string;
  width: number;
  height: number;
  pattern: string;
  boundary_rule_version: string;
  result_json: string | null;
  reconstructed_at: string | null;
}

export class ImageService {
  readonly maxPixels = DEFAULT_MAX_PIXELS;

  constructor(private readonly db: DatabaseSync) {}

  importMosaic(input: MosaicInput): ImageVersionSummary {
    const mosaic = parseMosaicInput(input, this.maxPixels);
    const imageId = randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO images(id, created_at) VALUES(?, ?)").run(imageId, now);
      this.insertVersion(imageId, 1, mosaic, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getVersion(imageId, 1);
  }

  changePattern(imageId: string, pattern: unknown): ImageVersionSummary {
    if (!isBayerPattern(pattern)) {
      throw new AppError("INVALID_PATTERN", "pattern 必须是 RGGB、BGGR、GRBG 或 GBRG");
    }
    const versions = this.versions(imageId);
    if (versions.length === 0) throw new AppError("IMAGE_NOT_FOUND", "图像不存在", 404);
    const latest = versions[versions.length - 1];
    if (!latest) throw new AppError("IMAGE_NOT_FOUND", "图像不存在", 404);
    if (latest.pattern === pattern) return this.getVersion(imageId, latest.version);

    const mosaic = this.loadMosaic(imageId, latest.version);
    mosaic.pattern = pattern;
    const nextVersion = latest.version + 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertVersion(imageId, nextVersion, mosaic, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getVersion(imageId, nextVersion);
  }

  reconstruct(imageId: string, version?: number): ImageVersionDetail {
    const summary = version === undefined ? this.latestVersion(imageId) : this.getVersion(imageId, version);
    if (summary.resultJson) return this.detail(summary);
    const mosaic = this.loadMosaic(imageId, summary.version);
    const result = reconstruct(mosaic);
    this.db.prepare("UPDATE versions SET result_json = ?, reconstructed_at = ? WHERE image_id = ? AND version = ?")
      .run(JSON.stringify(result), new Date().toISOString(), imageId, summary.version);
    return this.detail(this.getVersion(imageId, summary.version));
  }

  validate(imageId: string, version?: number): ValidationReport {
    const detail = this.reconstruct(imageId, version);
    const mosaic = this.loadMosaic(imageId, detail.version);
    const result = detail.result;
    const errors: string[] = [];
    for (let y = 0; y < result.height; y += 1) {
      for (let x = 0; x < result.width; x += 1) {
        const prov = result.provenance[y * result.width + x];
        const expectedPhase = phaseAt(result.pattern, x, y);
        if (!prov) throw new AppError("INTERNAL_ERROR", "来源记录缺失", 500);
        for (const channel of ["R", "G", "B"] as Channel[]) {
          const item = prov.channels[channel];
          const weightSum = item.sources.reduce((sum, source) => sum + source.weight, 0);
          if (Math.abs(weightSum - 1) > 1e-12) errors.push(`(${x},${y}) ${channel} 权重和不为 1`);
          if (item.sources.some(source => source.channel !== channel)) errors.push(`(${x},${y}) ${channel} 来源颜色错误`);
          if (channel === expectedPhase) {
            const raw = mosaic.values[y * mosaic.width + x];
            if (!item.measured || item.value !== raw || item.sources.length !== 1) {
              errors.push(`(${x},${y}) 实测通道未直接保留`);
            }
          }
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  phase(imageId: string, x: number, y: number, version?: number): PhaseResponse {
    const summary = version === undefined ? this.latestVersion(imageId) : this.getVersion(imageId, version);
    assertCoordinate(x, y, summary.width, summary.height);
    return {
      imageId,
      version: summary.version,
      x,
      y,
      channel: phaseAt(summary.pattern as BayerPattern, x, y),
      pattern: summary.pattern,
      boundaryRuleVersion: summary.boundaryRuleVersion
    };
  }

  provenance(imageId: string, x: number, y: number, version?: number): PixelProvenance {
    const result = this.reconstruct(imageId, version).result;
    assertCoordinate(x, y, result.width, result.height);
    const prov = result.provenance[y * result.width + x];
    if (!prov) throw new AppError("INTERNAL_ERROR", "来源不存在", 500);
    return prov;
  }

  listProvenance(imageId: string, offset: number, limit: number, version?: number) {
    const result = this.reconstruct(imageId, version).result;
    return paginate(result.provenance, { offset, limit }, 64);
  }

  listVersions(imageId: string): ImageVersionSummary[] {
    return this.versions(imageId);
  }

  result(imageId: string, version?: number): Reconstruction {
    return this.reconstruct(imageId, version).result;
  }

  comparePatterns(input: MosaicInput, patterns?: readonly BayerPattern[]): PatternComparison[] {
    const mosaic = parseMosaicInput(input, this.maxPixels);
    const requested = patterns ?? (["RGGB", "BGGR", "GRBG", "GBRG"] as BayerPattern[]);
    return requested.map(pattern => {
      if (!isBayerPattern(pattern)) {
        throw new AppError("INVALID_PATTERN", "比较排列无效");
      }
      const candidate: Mosaic = { ...mosaic, pattern };
      const result = reconstruct(candidate);
      return { pattern, result };
    });
  }

  private insertVersion(imageId: string, version: number, mosaic: Mosaic, createdAt: string): void {
    this.db.prepare(`
      INSERT INTO versions(image_id, version, created_at, width, height, pattern, boundary_rule_version)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(imageId, version, createdAt, mosaic.width, mosaic.height, mosaic.pattern, "bayer-bilinear-neighbor-v1");
    const insertSample = this.db.prepare(
      "INSERT INTO raw_samples(image_id, version, x, y, value, phase) VALUES(?, ?, ?, ?, ?, ?)"
    );
    for (let y = 0; y < mosaic.height; y += 1) {
      for (let x = 0; x < mosaic.width; x += 1) {
        const value = mosaic.values[y * mosaic.width + x];
        if (value === undefined) throw new AppError("MISSING_SAMPLES", "内部样本不完整");
        insertSample.run(imageId, version, x, y, value, phaseAt(mosaic.pattern, x, y));
      }
    }
  }

  private loadMosaic(imageId: string, version: number): Mosaic {
    const summary = this.getVersion(imageId, version);
    const rows = this.db.prepare(
      "SELECT x, y, value FROM raw_samples WHERE image_id = ? AND version = ?"
    ).all(imageId, version) as Array<{ x: number; y: number; value: number }>;
    if (rows.length !== summary.width * summary.height) {
      throw new AppError("INTERNAL_ERROR", "重启后读取到的原样本不完整", 500);
    }
    const values = new Array<number>(summary.width * summary.height).fill(Number.NaN);
    for (const row of rows) values[row.y * summary.width + row.x] = row.value;
    if (values.some(value => !Number.isFinite(value))) {
      throw new AppError("INTERNAL_ERROR", "原样本缺失或非有限", 500);
    }
    return { width: summary.width, height: summary.height, pattern: summary.pattern as BayerPattern, values };
  }

  private reconstructOneRaw(mosaic: Mosaic, x: number, y: number): PixelProvenance {
    return reconstructPixel(mosaic, x, y);
  }

  private versions(imageId: string): ImageVersionSummary[] {
    const rows = this.db.prepare("SELECT * FROM versions WHERE image_id = ? ORDER BY version").all(imageId) as unknown as VersionRow[];
    return rows.map(row => this.toSummary(row));
  }

  private latestVersion(imageId: string): ImageVersionSummary {
    const row = this.db.prepare(
      "SELECT * FROM versions WHERE image_id = ? ORDER BY version DESC LIMIT 1"
    ).get(imageId) as unknown as VersionRow | undefined;
    if (!row) throw new AppError("IMAGE_NOT_FOUND", "图像不存在", 404);
    return this.toSummary(row);
  }

  getVersion(imageId: string, version: number): ImageVersionSummary {
    const row = this.db.prepare("SELECT * FROM versions WHERE image_id = ? AND version = ?")
      .get(imageId, version) as unknown as VersionRow | undefined;
    if (!row) throw new AppError("VERSION_NOT_FOUND", "图像或版本不存在", 404);
    return this.toSummary(row);
  }

  private detail(summary: ImageVersionSummary): ImageVersionDetail {
    if (!summary.resultJson) throw new AppError("RESULT_NOT_READY", "结果尚未重建", 409);
    return { ...summary, result: JSON.parse(summary.resultJson) as Reconstruction };
  }

  private toSummary(row: VersionRow): ImageVersionSummary {
    const summary: ImageVersionSummary = {
      imageId: row.image_id,
      version: row.version,
      createdAt: row.created_at,
      width: row.width,
      height: row.height,
      pattern: row.pattern as BayerPattern,
      boundaryRuleVersion: row.boundary_rule_version,
      resultJson: row.result_json
    };
    if (row.reconstructed_at) summary.reconstructedAt = row.reconstructed_at;
    return summary;
  }
}

export interface ImageVersionSummary {
  imageId: string;
  version: number;
  createdAt: string;
  width: number;
  height: number;
  pattern: BayerPattern;
  boundaryRuleVersion: string;
  reconstructedAt?: string;
  resultJson: string | null;
}

interface ImageVersionDetail extends ImageVersionSummary {
  result: Reconstruction;
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
}

export interface PhaseResponse {
  imageId: string;
  version: number;
  x: number;
  y: number;
  channel: Channel;
  pattern: BayerPattern;
  boundaryRuleVersion: string;
}

export interface PatternComparison {
  pattern: BayerPattern;
  result: Reconstruction;
}
