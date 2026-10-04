import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../core/errors.js";
import { constantMosaic, gradientMosaic } from "../core/fixtures.js";
import { referenceChannel } from "../core/reference.js";
import { reconstruct, reconstructPixel } from "../core/reconstruct.js";
import type { BayerPattern, Channel, Mosaic } from "../core/types.js";
import { parseMosaicInput, phaseAt } from "../core/validation.js";

const patterns: BayerPattern[] = ["RGGB", "BGGR", "GRBG", "GBRG"];
const constants = { R: 0.2, G: 0.5, B: 0.8 };

test("四种排列的常值场景均重建为常值 RGB 且实测保留", () => {
  for (const pattern of patterns) {
    for (const size of [[2, 2], [3, 3], [5, 2], [2, 5], [5, 7]] as const) {
      const mosaic = parseMosaicInput(constantMosaic(size[0], size[1], pattern, constants));
      const result = reconstruct(mosaic);
      assert.equal(result.width, size[0]);
      assert.equal(result.height, size[1]);
      for (let y = 0; y < size[1]; y += 1) {
        for (let x = 0; x < size[0]; x += 1) {
          assert.deepEqual(result.rgb[y]?.[x], [constants.R, constants.G, constants.B]);
          const prov = result.provenance[y * size[0] + x]!;
          for (const channel of ["R", "G", "B"] as Channel[]) {
            const item = prov.channels[channel];
            assert.ok(Math.abs(item.sources.reduce((sum, s) => sum + s.weight, 0) - 1) < 1e-12);
            assert.ok(item.sources.every(source => source.channel === channel));
          }
          assert.equal(prov.channels[phaseAt(pattern, x, y)].measured, true);
        }
      }
    }
  }
});

test("梯度结果与独立按坐标邻居参考一致，反向扫描也相同", () => {
  for (const pattern of patterns) {
    const mosaic = parseMosaicInput(gradientMosaic(5, 7, pattern));
    const forward = reconstruct(mosaic);
    const reverseProvenance = [];
    for (let y = mosaic.height - 1; y >= 0; y -= 1) {
      for (let x = mosaic.width - 1; x >= 0; x -= 1) {
        reverseProvenance[y * mosaic.width + x] = reconstructPixel(mosaic, x, y);
      }
    }
    for (let y = 0; y < mosaic.height; y += 1) {
      for (let x = 0; x < mosaic.width; x += 1) {
        for (const channel of ["R", "G", "B"] as Channel[]) {
          assert.ok(Math.abs(
            forward.provenance[y * mosaic.width + x]!.channels[channel].value -
            referenceChannel(mosaic, x, y, channel)
          ) < 1e-12);
        }
      }
    }
    assert.deepEqual(reverseProvenance, forward.provenance);
  }
});

test("四角只平均真实存在且颜色匹配的邻居，不补零不环绕", () => {
  const mosaic = parseMosaicInput(gradientMosaic(4, 4, "RGGB"));
  const result = reconstruct(mosaic);
  const corners = [[0, 0], [3, 0], [0, 3], [3, 3]] as const;
  for (const [x, y] of corners) {
    const pixel = result.provenance[y * 4 + x]!;
    for (const channel of ["R", "G", "B"] as Channel[]) {
      for (const source of pixel.channels[channel].sources) {
        assert.ok(source.x >= 0 && source.x < 4 && source.y >= 0 && source.y < 4);
        assert.equal(source.channel, phaseAt("RGGB", source.x, source.y));
      }
    }
  }
  const redAtOrigin = result.provenance[0]!.channels.B;
  assert.equal(redAtOrigin.measured, false);
  assert.deepEqual(redAtOrigin.sources.map(s => [s.x, s.y]), [[1, 1]]);
  assert.equal(redAtOrigin.sources[0]?.weight, 1);
});

test("绿色两种相位分别使用水平或垂直的红与蓝", () => {
  const mosaic = parseMosaicInput(gradientMosaic(5, 5, "GRBG"));
  const greenAtRight = reconstructPixelAt(mosaic, 0, 0);
  assert.equal(greenAtRight.channels.G.measured, true);
  assert.deepEqual(greenAtRight.channels.R.sources.map(s => [s.x, s.y]), [[1, 0]]);
  assert.deepEqual(greenAtRight.channels.B.sources.map(s => [s.x, s.y]), [[0, 1]]);

  const greenAtLeft = reconstructPixelAt(mosaic, 1, 1);
  assert.equal(greenAtLeft.channels.G.measured, true);
  assert.deepEqual(greenAtLeft.channels.R.sources.map(s => [s.x, s.y]), [[1, 0], [1, 2]]);
  assert.deepEqual(greenAtLeft.channels.B.sources.map(s => [s.x, s.y]), [[0, 1], [2, 1]]);
});

test("拒绝负数、越界、非有限值和过小尺寸", () => {
  const base = constantMosaic(2, 2, "RGGB", constants);
  assert.throws(() => parseMosaicInput({ ...base, width: 1 }), AppError);
  const negativeRows = [[-1, 0], [0, 0]];
  assert.throws(() => parseMosaicInput({ ...base, rows: negativeRows }), (error: unknown) =>
    error instanceof AppError && error.code === "SAMPLE_OUT_OF_RANGE");
  const nanRows = [[Number.NaN, 0], [0, 0]];
  assert.throws(() => parseMosaicInput({ ...base, rows: nanRows }), (error: unknown) =>
    error instanceof AppError && error.code === "INVALID_SAMPLE_VALUE");
  const infinityRows = [[Number.POSITIVE_INFINITY, 0], [0, 0]];
  assert.throws(() => parseMosaicInput({ ...base, rows: infinityRows }), (error: unknown) =>
    error instanceof AppError && error.code === "INVALID_SAMPLE_VALUE");
});

function reconstructPixelAt(mosaic: Mosaic, x: number, y: number) {
  return reconstruct(mosaic).provenance[y * mosaic.width + x]!;
}
