# Ocean-TSD 数据管线

本目录是「海洋分析-温盐深三维体」案例的数据预处理工具链。浏览器端只读取
`public/data/ocean-tsd/` 下经过预处理的轻量二进制数据，不会现场访问数据门户，
也不会在前端保存账号令牌。

## 文件

| 文件 | 说明 |
|---|---|
| `generate-sample-data.mjs` | 生成默认的**程序化样本**数据（`timeKind: "demo"`），用于演示完整管线与可视化 / 分析流程。Node 运行，无第三方依赖。 |
| `preprocess_ocean.py` | 从官方再分析 NetCDF 子集裁剪研究区域并写出同格式二进制数据。需要 `xarray` / `netCDF4` / `numpy`。 |
| `validate_ocean_dataset.py` | 校验 manifest 与二进制块的尺寸、深度方向、掩膜、解码范围和量化误差（仅标准库）。 |

## 生成默认样本

```bash
node scripts/ocean-tsd/generate-sample-data.mjs
```

## 接入真实数据

1. 使用 Copernicus Marine 或 NOAA WOA23 获取研究区域子集（thetao / so / uo / vo + bathymetry）。
2. 运行预处理：

```bash
python scripts/ocean-tsd/preprocess_ocean.py \
  --temperature thetao.nc --salinity so.nc --uo uo.nc --vo vo.nc --bathymetry bathy.nc \
  --out public/data/ocean-tsd/east-china-sea \
  --west 121.5 --south 25 --east 128 --north 31 --depth-max 1560 \
  --time-kind monthly-climatology \
  --source "Copernicus Marine GLOBAL_MULTIYEAR_PHY_001_030"
```

3. 校验：

```bash
python scripts/ocean-tsd/validate_ocean_dataset.py public/data/ocean-tsd/east-china-sea
```

## 二进制格式

```
coords.bin        头(3×uint32: nx,ny,nz) + lon(f32×nx) + lat(f32×ny) + depth(f32×nz)
bathymetry.bin    海底地形，正向下，f32×nx×ny，索引 idx = x + nx*y
mask.bin          有效海水掩膜，uint8×nx×ny×nz（1=有效），索引 idx = x + nx*(y + ny*z)
frames/MM.bin     月份 MM 数据块：按 varOrder（默认 [temperature,salinity,u,v]）
                  依次写入 uint16×nx×ny×nz，解码值 = raw*scale + offset，raw==65535 为缺测
manifest.json     来源、时间类型、单位、原生分辨率、量化参数与文件清单
```

## 数据声明

默认样本由 `generate-sample-data.mjs` **程序化生成**，用于演示，不代表任何真实观测或官方
再分析产品。案例界面会显著标注「示例数据」。要用于科研或业务，请接入真实数据源并在
`manifest.json` 中如实填写 `source` / `productId` / `license` / `timeKind` 等字段。
