import type * as THREE from 'three'

interface ResourceRef {
  refs: number
  dispose: () => void
}

export class ResourceTracker {
  private resources = new Map<string, ResourceRef>()

  private register(key: string, dispose: () => void): void {
    const existing = this.resources.get(key)
    if (existing) {
      existing.refs += 1
      return
    }
    this.resources.set(key, { refs: 1, dispose })
  }

  private release(key: string): void {
    const entry = this.resources.get(key)
    if (!entry) return
    entry.refs -= 1
    if (entry.refs > 0) return
    entry.dispose()
    this.resources.delete(key)
  }

  trackGeometry(geometry: THREE.BufferGeometry): void {
    this.register(`geometry:${geometry.uuid}`, () => geometry.dispose())
  }

  trackMaterial(material: THREE.Material): void {
    this.register(`material:${material.uuid}`, () => material.dispose())
  }

  trackTexture(texture: THREE.Texture): void {
    this.register(`texture:${texture.uuid}`, () => texture.dispose())
  }

  untrackGeometry(geometry: THREE.BufferGeometry): void {
    this.release(`geometry:${geometry.uuid}`)
  }

  untrackMaterial(material: THREE.Material): void {
    this.release(`material:${material.uuid}`)
  }

  trackObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) this.trackGeometry(mesh.geometry)
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) for (const item of material) this.trackMaterial(item)
      else if (material) this.trackMaterial(material)
    })
  }

  releaseObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) this.untrackGeometry(mesh.geometry)
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) for (const item of material) this.untrackMaterial(item)
      else if (material) this.untrackMaterial(material)
    })
    object.removeFromParent()
  }

  report(): { geometries: number; materials: number; textures: number; references: number } {
    let geometries = 0
    let materials = 0
    let textures = 0
    let references = 0
    for (const [key, entry] of this.resources) {
      references += entry.refs
      if (key.startsWith('geometry:')) geometries += 1
      else if (key.startsWith('material:')) materials += 1
      else if (key.startsWith('texture:')) textures += 1
    }
    return { geometries, materials, textures, references }
  }

  disposeAll(): void {
    for (const entry of this.resources.values()) entry.dispose()
    this.resources.clear()
  }
}
