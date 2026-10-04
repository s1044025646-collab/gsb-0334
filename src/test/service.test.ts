import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../db/database.js";
import { AppError } from "../core/errors.js";
import { gradientMosaic } from "../core/fixtures.js";
import { ImageService } from "../services/imageService.js";

test("导入、重建、改排列创建新版本，旧版本不被重新解释", () => {
  const { service, close } = createService();
  try {
    const first = service.importMosaic(gradientMosaic(3, 3, "RGGB"));
    const resultV1 = service.result(first.imageId, first.version);
    assert.equal(resultV1.pattern, "RGGB");
    const changed = service.changePattern(first.imageId, "BGGR");
    assert.equal(changed.version, 2);
    assert.equal(changed.resultJson, null);
    assert.equal(service.result(first.imageId, 1).pattern, "RGGB");
    assert.equal(service.result(first.imageId, 2).pattern, "BGGR");
    assert.equal(service.listVersions(first.imageId).length, 2);
  } finally {
    close();
  }
});

test("重建结果持久化，重新打开数据库后仍可用原样本复查来源", () => {
  const path = databasePath();
  const first = openDatabase(path);
  const service1 = new ImageService(first);
  const imported = service1.importMosaic(gradientMosaic(3, 4, "GRBG"));
  const beforeClose = service1.provenance(imported.imageId, 2, 1);
  first.close();

  const second = openDatabase(path);
  const service2 = new ImageService(second);
  const afterRestart = service2.provenance(imported.imageId, 2, 1);
  assert.deepEqual(afterRestart, beforeClose);
  second.close();
});

test("非法导入失败后不发布图像，分页不改变整图结果", () => {
  const { service, close } = createService();
  try {
    assert.throws(() => service.importMosaic({
      width: 2,
      height: 2,
      pattern: "RGGB",
      rows: [[0, 1], [1]]
    }), (error: unknown) => error instanceof AppError && error.code === "INVALID_SAMPLES");

    const imported = service.importMosaic(gradientMosaic(3, 3, "RGGB"));
    const all = service.result(imported.imageId);
    const page1 = service.listProvenance(imported.imageId, 0, 5);
    const page2 = service.listProvenance(imported.imageId, 5, 5);
    assert.equal(page1.total, 9);
    assert.equal(page1.data.length + page2.data.length, 9);
    assert.deepEqual([...page1.data, ...page2.data], all.provenance);
    assert.throws(() => service.phase(imported.imageId, 3, 0), AppError);
  } finally {
    close();
  }
});

test("排列比较对同一原样本临时计算四种结果", () => {
  const { service, close } = createService();
  try {
    const comparisons = service.comparePatterns(gradientMosaic(2, 2, "RGGB"));
    assert.deepEqual(comparisons.map(item => item.pattern), ["RGGB", "BGGR", "GRBG", "GBRG"]);
    assert.ok(comparisons.every(item => item.result.boundaryRuleVersion === "bayer-bilinear-neighbor-v1"));
  } finally {
    close();
  }
});

function createService(): { service: ImageService; close: () => void } {
  const db = openDatabase(databasePath());
  return { service: new ImageService(db), close: () => db.close() };
}

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "bayer-test-"));
  return join(dir, "test.sqlite");
}
