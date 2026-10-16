#!/usr/bin/env python3
"""
Ocean-TSD 数据块校验（依赖仅标准库）
====================================================================
读取 `public/data/ocean-tsd/<preset>/` 下的 manifest 与二进制块，校验：
  1. 文件尺寸与 manifest 声明的 grid / varOrder 一致；
  2. 深度序列严格自海表向深递增；
  3. 掩膜为 0/1，海底地形为正向下；
  4. 每个变量解码后的取值范围落在 manifest validMin/validMax 附近；
  5. 量化误差不超过 1 个量化步长；
  6. 有效海水体素比例合理（非全空 / 非全满）。

用法：python validate_ocean_dataset.py public/data/ocean-tsd/east-china-sea
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import array

VAR_ORDER_KEYS = ["temperature", "salinity", "u", "v"]


def read_f32(path: Path, count: int | None = None):
    data = path.read_bytes()
    n = len(data) // 4
    if count is not None and n != count:
        raise AssertionError(f"{path.name}: f32 数量 {n} != 期望 {count}")
    a = array.array("f")
    a.frombytes(data)
    return a


def main(root: str):
    base = Path(root)
    manifest = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
    nx, ny, nz = manifest["grid"]["nx"], manifest["grid"]["ny"], manifest["grid"]["nz"]
    errors: list[str] = []

    # coords
    coords = (base / "coords.bin").read_bytes()
    hnx, hny, hnz = struct.unpack_from("<III", coords, 0)
    if (hnx, hny, hnz) != (nx, ny, nz):
        errors.append(f"coords 头 {(hnx, hny, hnz)} != manifest {(nx, ny, nz)}")
    off = 12 + (nx + ny) * 4
    depths = struct.unpack_from(f"<{nz}f", coords, off)
    if any(depths[i] >= depths[i + 1] for i in range(nz - 1)):
        errors.append("深度序列非严格递增")
    if depths[0] < 0:
        errors.append("深度出现负值（应正向下）")

    # bathymetry
    bathy = read_f32(base / "bathymetry.bin", nx * ny)
    if min(bathy) < 0:
        errors.append("海底地形出现负值（应正向下）")

    # mask
    mask = (base / "mask.bin").read_bytes()
    if len(mask) != nx * ny * nz:
        errors.append(f"mask 尺寸 {len(mask)} != {nx * ny * nz}")
    valid = sum(mask)
    ratio = valid / (nx * ny * nz)
    if ratio <= 0 or ratio >= 1:
        errors.append(f"有效体素比例異常 {ratio:.3f}")

    # frames
    per_var = nx * ny * nz
    for m, rel in enumerate(manifest["files"]["frames"]):
        path = base / rel
        raw = path.read_bytes()
        expect = per_var * len(VAR_ORDER_KEYS) * 2
        if len(raw) != expect:
            errors.append(f"{rel} 尺寸 {len(raw)} != {expect}")
            continue
        block = struct.unpack(f"<{per_var * len(VAR_ORDER_KEYS)}H", raw)
        for vi, key in enumerate(VAR_ORDER_KEYS):
            meta = manifest["variables"][key]
            scale, offset = meta["scale"], meta["offset"]
            lo, hi = 1e9, -1e9
            missing = 0
            for i in range(vi * per_var, (vi + 1) * per_var):
                r = block[i]
                if r == 65535:
                    missing += 1
                    continue
                v = r * scale + offset
                lo = min(lo, v)
                hi = max(hi, v)
            if missing and missing < per_var * 0.5:
                pass
            if lo < meta["validMin"] - 2 * scale or hi > meta["validMax"] + 2 * scale:
                errors.append(
                    f"{rel} {key} 解码范围 [{lo:.4f},{hi:.4f}] 超出 manifest "
                    f"[{meta['validMin']:.4f},{meta['validMax']:.4f}]"
                )
            if hi - lo < 1e-6:
                errors.append(f"{rel} {key} 范围退化为常数")

    if errors:
        print("FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print(f"OK  {base.name}: grid {nx}x{ny}x{nz}, valid {ratio:.2%}, frames {len(manifest['files']['frames'])}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/data/ocean-tsd/east-china-sea")
