# Bayer 马赛克双线性重建后端

这是一个只包含后端 API 与 CLI 的 TypeScript/Node.js 项目。它从合成 Bayer CFA 原始单通道采样重建同尺寸线性 RGB，不接相机、不解码 RAW 厂商文件、不提供网页，也不调用现成去马赛克算法。

## 环境

- Windows 本地 PowerShell/命令行可运行
- Node.js 25+（使用内置 `node:sqlite`，无需本机编译 SQLite）
- 不需要 Docker、WSL、付费服务或外部在线 API

## 快速开始

```powershell
npm install
npm run build
npm test
npm run demo
npm start
```

默认监听 `127.0.0.1`，端口传 `0` 或不传时由操作系统选择空闲端口，启动日志会输出实际地址。

指定端口：

```powershell
node dist/cli/index.js serve --port 5180
```

## 输入格式

支持项目内 JSON 或 CSV 数值夹具。JSON 可使用二维 `rows`：

```json
{
  "width": 3,
  "height": 3,
  "pattern": "RGGB",
  "rows": [
    [0.1, 0.2, 0.15],
    [0.3, 0.4, 0.35],
    [0.2, 0.5, 0.25]
  ]
}
```

也可使用完整坐标样本 `samples: [{ "x": 0, "y": 0, "value": 0.1 }]`。CSV 首行为 `width,height,pattern`，第二行为实际宽高与排列，后续逐行给数值。

约束：

- `width`、`height` 均为不小于 2 的整数，允许奇数尺寸。
- `pattern` 只能是 `RGGB`、`BGGR`、`GRBG`、`GBRG`。
- 每个像素位置必须且只能提供一个数值。
- 值必须是 `[0, 1]` 内的有限线性数；负数、NaN、Infinity、超过 1 的值都会拒绝。
- 默认像素上限为 65,536（例如 256×256），超限返回 `IMAGE_TOO_LARGE`，避免整图结果和逐像素来源占用过多内存。

## 双线性规则

排列以左上角为原点按 2×2 周期重复；相位只由全局 `(x mod 2, y mod 2)` 决定，不会因为某一行宽度奇数而“重置”。

- 实测通道：直接保留原马赛克值和原坐标，权重为 1，不先模糊整图再覆盖。
- 红/蓝位置缺失绿色：只取上下左右正交相邻的真实绿色。
- 红位置缺蓝、蓝位置缺红：只取四个对角位置中颜色正确的真实样本。
- 绿色位置：先按该绿色所属行列相位判断红色和蓝色分别在水平轴还是垂直轴；两种绿色相位方向不同，不把所有绿色像素当成同一种方向。
- 边界：只平均真实存在且颜色匹配的邻居；越界不当零、不环绕、不复制颜色错误的最近像素。
- 权重：按实际可用邻居数量归一，因此来源权重和始终为 1。若理论支持范围内出现所需颜色无邻居，返回 `NO_REQUIRED_NEIGHBOR`，不输出 NaN。
- 所有来源坐标都指向输入原马赛克；插值结果不会再次作为来源参与插值，因此扫描顺序不改变结果。
- 输出保持浮点线性 RGB，不做 gamma、白平衡、降噪、锐化或其他后处理。

边界规则版本固定记录为：

```text
bayer-bilinear-neighbor-v1
```

## CLI

```powershell
# 导入夹具
node dist/cli/index.js import data/fixtures/gradient-3x3.json

# 重建并输出完整 RGB
node dist/cli/index.js reconstruct <imageId>

# 查询某点颜色相位
node dist/cli/index.js phase <imageId> --x 1 --y 0

# 单像素三通道来源表
node dist/cli/index.js pixel <imageId> --x 1 --y 1

# 验证实测保留、来源颜色和权重和
node dist/cli/index.js validate <imageId>

# 比较同一批原样本在四种排列下的结果（临时计算，不改当前版本）
node dist/cli/index.js compare data/fixtures/gradient-3x3.json

# 导出 JSON 或 CSV（按扩展名判断）
node dist/cli/index.js export <imageId> --out data/exports/result.csv

# 修改排列：创建新版本，旧结果不会在新排列下重新解释
node dist/cli/index.js pattern <imageId> --pattern BGGR

# 生成/导入小矩阵、演示单像素来源并写出夹具和导出文件
node dist/cli/index.js demo
```

## HTTP API

JSON 请求/响应，错误格式：

```json
{ "error": { "code": "INVALID_SAMPLE_VALUE", "message": "采样值必须是有限数值" } }
```

主要端点：

- `GET /health`：健康检查。
- `POST /api/mosaics`：导入马赛克。
- `GET /api/mosaics/:imageId/versions`：列出版本。
- `POST /api/mosaics/:imageId/pattern`：Body 为 `{ "pattern": "BGGR" }`，创建新版本。
- `POST /api/mosaics/:imageId/reconstruct`：执行或读取持久化重建结果。
- `GET /api/mosaics/:imageId/phase/:x/:y`：查询采样颜色相位。
- `GET /api/mosaics/:imageId/pixels/:x/:y`：查询单像素三通道来源。
- `GET /api/mosaics/:imageId/provenance?offset=0&limit=64`：分页查询来源；分页不改变整图计算。
- `GET /api/mosaics/:imageId/validate`：验证输出、实测保留、来源颜色与权重和。
- `POST /api/compare-patterns`：比较四种排列。

版本查询可加 `?version=1`。来源分页限制最大 1000 条，默认 64 条；边缘像素不会因显示裁剪而从整图计算中省略。

PowerShell 示例：

```powershell
node dist/cli/index.js serve

$body = Get-Content data/fixtures/gradient-3x3.json -Raw
$image = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5180/api/mosaics `
  -ContentType 'application/json' -Body $body
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5180/api/mosaics/$($image.imageId)/reconstruct"
Invoke-RestMethod -Uri "http://127.0.0.1:5180/api/mosaics/$($image.imageId)/pixels/1/1"
```

## 持久化

默认数据库：

```text
data/bayer.sqlite
```

可用 `BAYER_DB_PATH` 覆盖。SQLite 保存：

- 原始单通道样本与采样相位
- 宽高、排列、边界规则版本
- 图像版本和排列变更版本
- 已计算的 RGB 与逐像素来源结果

导入使用数据库事务，样本校验或写入失败会回滚，不会发布半幅图像。排列修改复制同一批原样本到新版本并重新解释采样颜色；旧 RGB 保持在旧版本，不在新排列下复用。重启后可从原样本和既有结果继续查询来源。

## 错误码

- `INVALID_INPUT`：请求不是有效对象。
- `INVALID_DIMENSIONS`：宽高缺失、非整数或小于 2。
- `IMAGE_TOO_LARGE`：超过像素上限。
- `INVALID_PATTERN`：排列不支持。
- `INVALID_SAMPLES`：行列形状或样本结构错误。
- `MISSING_SAMPLES` / `DUPLICATE_SAMPLE`：位置缺失或重复。
- `INVALID_SAMPLE_VALUE`：非有限数值。
- `SAMPLE_OUT_OF_RANGE`：值不在 `[0, 1]`。
- `INVALID_COORDINATE` / `INVALID_PAGE` / `INVALID_VERSION`：查询参数错误。
- `IMAGE_NOT_FOUND` / `VERSION_NOT_FOUND`：资源不存在。
- `NO_REQUIRED_NEIGHBOR`：所需颜色没有真实匹配邻居。
- `MEASURED_CHANNEL_NOT_PRESERVED`：内部自检发现实测通道未保留。

## 测试

```powershell
npm test
```

测试覆盖：

- 2×2、奇数宽高、多种长宽组合
- 四种排列和四个角
- 绿色在两种行列相位下的水平/垂直取色
- 每通道常值合成场景重建为对应常值 RGB
- 梯度小矩阵中心与边缘样本
- 负数、越界值、NaN、Infinity、过小尺寸
- 实测通道逐像素完全保留
- 来源颜色正确、权重按可用邻居归一且和为 1
- 独立按坐标取邻居参考实现核对结果
- 反向逐像素扫描与正向扫描结果一致
- SQLite 版本、事务失败回滚、重启后来源复查
- HTTP API 与结构化错误码

## 限制

简单双线性插值只利用近邻，能保留实测通道，但在高频纹理、边缘和拉链/棋盘细节处可能出现伪色、模糊、拉链伪影和细节损失。因此“每个颜色通道各自为常值时能恢复常值”只证明该合成场景正确，不能一般保证重建 RGB 与真实全色原图一致。该项目刻意不加入后处理，以免把重建步骤和画质增强步骤混淆。
