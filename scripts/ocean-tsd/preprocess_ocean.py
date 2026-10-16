#!/usr/bin/env python3
"""
Ocean-TSD 真实数据预处理（构建阶段工具，浏览器不依赖）
====================================================================
从官方海洋再分析 NetCDF 子集中裁剪研究区域，统一坐标 / 单位 / 缺测编码，
生成前端所需轻量二进制数据块（与 generate-sample-data.mjs 输出格式一致）：

    public/data/ocean-tsd/<preset>/
    ├── manifest.json        来源 / 范围 / 深度 / 变量 / 量化元数据
    ├── coords.bin           头(3×uint32) + lon(f32×nx) + lat(f32×ny) + depth(f32×nz)
    ├── bathymetry.bin       海底地形（正向下，m，f32×nx×ny）
    ├── mask.bin             有效海水掩膜（uint8×nx×ny×nz，1=有效）
    └── frames/MM.bin        各月 [temperature, salinity, u, v] 依次 uint16

推荐数据源
----------
- Copernicus Marine GLOBAL_MULTIYEAR_PHY_001_030（GLORYS12V1）：
  日 / 月 / 气候态数据集，约 1/12°、50 标准层，含 thetao / so / uo / vo 与静态 bathymetry。
  数据集 ID 示例：月平均 `cmems_mod_glo_phy_my_0.083deg_P1M-m`，
  月气候态 `cmems_mod_glo_phy_my_0.083deg-climatology_P1M-m`。
  入口：https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/services
- NOAA WOA23（温度 / 盐度气候态，102 标准层）：
  入口：https://www.ncei.noaa.gov/access/world-ocean-atlas-2023/

依赖（示例）
------------
    pip install xarray netCDF4 numpy copernicusmarine

用法
----
    python preprocess_ocean.py \
        --temperature thetao.nc --salinity so.nc \
        --uo uo.nc --vo vo.nc --bathymetry bathy.nc \
        --out ../../public/data/ocean-tsd/east-china-sea \
        --west 121.5 --south 25 --east 128 --north 31 \
        --depth-max 1560 --time-kind monthly-reanalysis

注意
----
- 本脚本不负责登录 / 下载；请通过 copernicusmarine CLI 或门户预先获取子集，
  避免在脚本或前端硬编码账号令牌。
- 密度不落盘：前端由 T/S 经 EOS-80 sigma_t 实时计算；若需 TEOS-10，请另行
  预处理并作为独立变量扩展 VAR_ORDER。
"""

from __future__ import annotations

import argparse
import json
import struct
from datetime import date
from pathlib import Path

import numpy as np

VAR_ORDER = ["temperature", "salinity", "u", "v"]
MONTHS = [f"{i}月" for i in range(1, 13)]

# 每变量量化步长（scale），offset 运行时按实际最小值对齐
QUANT_SCALE = {"temperature": 0.005, "salinity": 0.001, "u": 0.0005, "v": 0.0005}
UNITS = {"temperature": "°C", "salinity": "PSU", "u": "m/s", "v": "m/s"}
LABELS = {"temperature": "温度", "salinity": "盐度", "u": "东西向流速 u", "v": "南北向流速 v"}


def load_field(path: str, var: str, extent, depths, nx, ny, nz):
    """读取单个 NetCDF 变量并双线性重采样到目标规则网格，返回 (nx,ny,nz) 数组（z 自海表向下）。"""
    import xarray as xr

    ds = xr.open_dataset(path)
    da = ds[var] if var in ds else ds[list(ds.data_vars)[0]]
    # 统一纬度/经度顺序
    lon_name = "longitude" if "longitude" in da.coords else "lon"
    lat_name = "latitude" if "latitude" in da.coords else "lat"
    depth_name = "depth" if "depth" in da.coords else ("deptht" if "deptht" in da.coords else "lev")
    da = da.sortby(lat_name).sortby(lon_name)
    if float(da[depth_name][0]) > float(da[depth_name][-1]):
        da = da.sortby(depth_name)  # 确保深度自浅向深

    sub = da.sel(
        {lon_name: slice(extent["west"], extent["east"]), lat_name: slice(extent["south"], extent["north"])}
    )
    if "time" in sub.dims:
        sub = sub.isel(time=0)
    # 垂向线性插值到标准深度
    sub = sub.interp({depth_name: depths}, kwargs={"fill_value": np.nan})
    # 水平重采样到目标网格
    lon = np.linspace(extent["west"], extent["east"], nx)
    lat = np.linspace(extent["south"], extent["north"], ny)
    sub = sub.interp({lon_name: lon, lat_name: lat}, kwargs={"fill_value": np.nan})
    values = np.asarray(sub.values, dtype=np.float32).transpose(2, 1, 0)  # (nz, ny, nx)
    return values  # 索引：z,y,x


def load_bathymetry(path: str, extent, nx, ny):
    import xarray as xr

    ds = xr.open_dataset(path)
    var = list(ds.data_vars)[0]
    da = ds[var]
    lon_name = "longitude" if "longitude" in da.coords else "lon"
    lat_name = "latitude" if "latitude" in da.coords else "lat"
    da = da.sortby(lat_name).sortby(lon_name)
    lon = np.linspace(extent["west"], extent["east"], nx)
    lat = np.linspace(extent["south"], extent["north"], ny)
    sub = da.interp({lon_name: lon, lat_name: lat}, kwargs={"fill_value": np.nan})
    bathy = np.asarray(sub.values, dtype=np.float32).reshape(ny, nx)
    bathy = np.where(np.isfinite(bathy), bathy, 0.0)
    return np.abs(bathy)  # 统一为正向下


def write_preset(args, arrays, bathymetry):
    out = Path(args.out)
    (out / "frames").mkdir(parents=True, exist_ok=True)
    nx = arrays["temperature"].shape[2]
    ny = arrays["temperature"].shape[1]
    nz = arrays["temperature"].shape[0]
    depths = np.asarray(args.depths, dtype=np.float32)

    # coords.bin
    with open(out / "coords.bin", "wb") as fh:
        fh.write(struct.pack("<III", nx, ny, nz))
        fh.write(np.linspace(args.west, args.east, nx).astype("<f4").tobytes())
        fh.write(np.linspace(args.south, args.north, ny).astype("<f4").tobytes())
        fh.write(depths.astype("<f4").tobytes())

    # bathymetry.bin
    with open(out / "bathymetry.bin", "wb") as fh:
        fh.write(bathymetry.astype("<f4").tobytes())

    # mask.bin：格点深度 <= 海底地形 且 各变量均非缺测
    valid_var = np.ones((nz, ny, nx), dtype=bool)
    for v in VAR_ORDER:
        valid_var &= np.isfinite(arrays[v])
    seabed = bathymetry[None, :, :]
    mask = (depths[:, None, None] <= seabed) & valid_var
    with open(out / "mask.bin", "wb") as fh:
        fh.write(mask.astype(np.uint8).tobytes())

    variables = {}
    for v in VAR_ORDER:
        arr = arrays[v]
        finite = arr[np.isfinite(arr)]
        vmin = float(np.nanmin(finite)) if finite.size else 0.0
        vmax = float(np.nanmax(finite)) if finite.size else 1.0
        variables[v] = {
            "sourceVariable": v,
            "label": LABELS[v],
            "unit": UNITS[v],
            "scale": QUANT_SCALE[v],
            "offset": float(round(vmin / QUANT_SCALE[v]) * QUANT_SCALE[v]),
            "validMin": vmin,
            "validMax": vmax,
            "missingValue": 65535,
        }

    # frames：所有月份写同一（单月）场；接月气候态时按 time 维逐月展开
    for i in range(12):
        block = np.full((len(VAR_ORDER), nz, ny, nx), 65535, dtype=np.uint16)
        for vi, v in enumerate(VAR_ORDER):
            meta = variables[v]
            raw = np.round((arrays[v] - meta["offset"]) / meta["scale"])
            raw = np.clip(raw, 0, 65534)
            raw = np.where(np.isfinite(arrays[v]), raw, 65535).astype(np.uint16)
            block[vi] = raw
        with open(out / "frames" / f"{i + 1:02d}.bin", "wb") as fh:
            fh.write(block.astype("<u2").tobytes())

    manifest = {
        "id": Path(args.out).name,
        "title": args.title,
        "source": args.source,
        "productId": args.product_id,
        "sourceUrl": args.source_url,
        "sourceVersion": args.source_version,
        "citation": args.citation,
        "license": args.license,
        "generatedAt": date.today().isoformat(),
        "timeKind": args.time_kind,
        "timeNote": args.time_note,
        "timeLabels": MONTHS,
        "regionName": args.region_name,
        "extent": {"west": args.west, "south": args.south, "east": args.east, "north": args.north},
        "nativeResolution": {"lonLat": args.native_resolution, "verticalLevels": nz, "depthsM": depths.tolist()},
        "grid": {"nx": nx, "ny": ny, "nz": nz, "encoding": "uint16"},
        "verticalPositive": "down",
        "depthRangeM": [float(depths.min()), float(depths.max())],
        "bathymetryRangeM": [float(np.nanmin(bathymetry)), float(np.nanmax(bathymetry))],
        "densityMethod": "位密度异常 σt：EOS-80 标准大气压密度减 1000，参考压力 0 dbar，由数据块 T/S 实时计算",
        "variables": variables,
        "varOrder": VAR_ORDER,
        "files": {
            "coords": "coords.bin",
            "bathymetry": "bathymetry.bin",
            "mask": "mask.bin",
            "frames": [f"frames/{i + 1:02d}.bin" for i in range(12)],
        },
    }
    with open(out / "manifest.json", "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print(f"[preprocess] wrote {out}  grid {nx}x{ny}x{nz}")


def main():
    ap = argparse.ArgumentParser(description="Ocean-TSD NetCDF → 前端二进制预处理")
    ap.add_argument("--temperature", required=True)
    ap.add_argument("--salinity", required=True)
    ap.add_argument("--uo", required=True)
    ap.add_argument("--vo", required=True)
    ap.add_argument("--bathymetry", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--west", type=float, required=True)
    ap.add_argument("--south", type=float, required=True)
    ap.add_argument("--east", type=float, required=True)
    ap.add_argument("--north", type=float, required=True)
    ap.add_argument("--depth-max", type=float, default=1500.0)
    ap.add_argument("--depths", type=float, nargs="*", default=None)
    ap.add_argument("--nx", type=int, default=64)
    ap.add_argument("--ny", type=int, default=64)
    ap.add_argument("--title", default="海洋温盐深样本")
    ap.add_argument("--region-name", default="研究区域")
    ap.add_argument("--source", default="Copernicus Marine GLOBAL_MULTIYEAR_PHY_001_030")
    ap.add_argument("--product-id", default="GLOBAL_MULTIYEAR_PHY_001_030")
    ap.add_argument("--source-url", default="https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/services")
    ap.add_argument("--source-version", default="")
    ap.add_argument("--citation", default="")
    ap.add_argument("--license", default="")
    ap.add_argument("--time-kind", default="monthly-reanalysis", choices=["observation", "reanalysis", "monthly-climatology", "demo"])
    ap.add_argument("--time-note", default="")
    ap.add_argument("--native-resolution", default="")
    args = ap.parse_args()

    extent = {"west": args.west, "south": args.south, "east": args.east, "north": args.north}
    if args.depths:
        depths = list(map(float, args.depths))
    else:
        depths = np.unique(np.concatenate([np.arange(0, 40, 4), np.geomspace(40, args.depth_max, 24)])).tolist()
        depths[-1] = args.depth_max
    nz = len(depths)
    nx, ny = args.nx, args.ny

    arrays = {
        "temperature": load_field(args.temperature, "thetao", extent, depths, nx, ny, nz),
        "salinity": load_field(args.salinity, "so", extent, depths, nx, ny, nz),
        "u": load_field(args.uo, "uo", extent, depths, nx, ny, nz),
        "v": load_field(args.vo, "vo", extent, depths, nx, ny, nz),
    }
    bathy = load_bathymetry(args.bathymetry, extent, nx, ny)
    args.depths = depths
    write_preset(args, arrays, bathy)


if __name__ == "__main__":
    main()
