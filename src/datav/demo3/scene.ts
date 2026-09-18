import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { createGridGround } from '../common/effects'

import hdrUrl from '../assets/hdr/venice_sunset_1k.hdr?url'
import turbineUrl from '../assets/model/turbine.glb?url'

let sharedDraco: DRACOLoader | null = null
function getDracoLoader(): DRACOLoader {
  if (!sharedDraco) {
    sharedDraco = new DRACOLoader()
    sharedDraco.setDecoderPath('/draco/gltf/')
  }
  return sharedDraco
}

export interface Demo3Scene {
  group: THREE.Group
  composer: EffectComposer
  setDisassembled: (v: boolean) => void
  update: (dt: number) => void
  pickHover: (raycaster: THREE.Raycaster) => void
  resize: (w: number, h: number) => void
  dispose: () => void
}

interface PartState {
  mesh: THREE.Mesh
  origin: THREE.Vector3
  target: THREE.Vector3
}

export async function buildDemo3Scene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): Promise<Demo3Scene> {
  const group = new THREE.Group()

  const hdrLoader = new HDRLoader()
  const hdr = await hdrLoader.loadAsync(hdrUrl)
  hdr.mapping = THREE.EquirectangularReflectionMapping
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromEquirectangular(hdr).texture
  scene.environment = env
  scene.background = env
  scene.backgroundBlurriness = 0.8
  hdr.dispose()
  pmrem.dispose()

  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(getDracoLoader())
  const gltf = await gltfLoader.loadAsync(turbineUrl)
  const model = gltf.scene
  model.scale.setScalar(2)
  model.position.z = -1
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
  group.add(model)

  const grid = createGridGround({
    y: -1.4,
    cellSize: 0.6,
    sectionSize: 3.3,
    sectionColor: '#7f7fff',
    cellColor: '#555555',
    planeSize: 60,
    opacity: 0.7,
  })
  group.add(grid)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4)
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(6, 10, 4)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  group.add(hemi, key)

  const parts: PartState[] = []
  const direct = model.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[]
  const mid = (direct.length - 1) / 2
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const origin = mesh.position.clone()
    const index = direct.indexOf(mesh)
    const distance = (index - mid) * 0.1
    parts.push({
      mesh,
      origin,
      target: origin.clone().setZ(index >= 0 ? origin.z + distance : origin.z),
    })
  })

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(renderer.domElement.width, renderer.domElement.height), 0.55, 0.4, 0.85)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  let disassembled = false
  let hovered: THREE.Mesh | null = null
  const blade = model.getObjectByName('defaultMaterial_45')
  let lastW = renderer.domElement.width
  let lastH = renderer.domElement.height

  return {
    group,
    composer,
    setDisassembled(v) {
      disassembled = v
    },
    update(dt) {
      if (!disassembled && blade) blade.rotateY(dt * 10)
      for (const part of parts) {
        const goal = disassembled ? part.target : part.origin
        part.mesh.position.lerp(goal, Math.min(1, dt * 3))
      }
    },
    pickHover(raycaster) {
      const hits = raycaster.intersectObject(model, true)
      if (hovered) {
        const mat = hovered.material as THREE.MeshStandardMaterial
        if (mat.emissive && hovered.userData.originHex !== undefined) {
          mat.emissive.setHex(hovered.userData.originHex)
        }
        hovered = null
      }
      const mesh = hits[0]?.object as THREE.Mesh | undefined
      if (!mesh?.isMesh) return
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (!mat?.emissive) return
      mesh.userData.originHex = mat.emissive.getHex()
      mat.emissive.setHex(0xff0000)
      hovered = mesh
    },
    resize(w, h) {
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      composer.setSize(w, h)
    },
    dispose() {
      env.dispose()
      composer.dispose()
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
    },
  }
}
