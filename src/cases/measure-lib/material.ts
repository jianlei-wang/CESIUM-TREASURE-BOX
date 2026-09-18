import { Color, Material } from 'cesium'

export function makeLineMaterial(color: Color): Material {
  return Material.fromType(Material.ColorType, { color })
}

export function makeDashMaterial(color: Color): Material {
  return Material.fromType(Material.PolylineDashType, { color, dashLength: 10 })
}
