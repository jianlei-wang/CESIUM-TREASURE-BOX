export type RigidShape = 'sphere' | 'box'

export interface RigidBodySpec {
  id: string
  shape: RigidShape
  position: [number, number, number]
  radius?: number
  halfExtents?: [number, number, number]
  velocity?: [number, number, number]
  mass?: number
  restitution?: number
  friction?: number
  linearDamping?: number
}

export interface StaticPlaneSpec {
  height: number
  restitution?: number
  friction?: number
}

export interface RigidBodySnapshot {
  id: string
  position: [number, number, number]
  rotation: [number, number, number, number]
  sleeping: boolean
}

export interface PhysicsWorld {
  readonly backend: 'rapier' | 'analytic'
  addBody(spec: RigidBodySpec): void
  addGround(plane: StaticPlaneSpec): void
  removeBody(id: string): void
  step(dt: number): number
  snapshots(): RigidBodySnapshot[]
  bodyCount(): number
  reset(): void
  dispose(): void
}

type RapierModule = typeof import('@dimforge/rapier3d-compat')

let rapierPromise: Promise<RapierModule | null> | null = null
let rapierWarned = false

export async function loadRapier(): Promise<RapierModule | null> {
  if (!rapierPromise) {
    rapierPromise = (async () => {
      try {
        const url = '/vendor/rapier/rapier.es.js'
        const module = (await import(/* @vite-ignore */ url)) as { default?: RapierModule } & RapierModule
        const rapier = module.default ?? module
        await rapier.init()
        return rapier
      } catch (error) {
        if (!rapierWarned) {
          rapierWarned = true
          console.warn('[physics] Rapier 运行时不可用，回退到确定性解析刚体后端', error)
        }
        return null
      }
    })()
  }
  return rapierPromise
}

export class AnalyticRigidWorld implements PhysicsWorld {
  readonly backend = 'analytic' as const
  private bodies = new Map<string, { spec: RigidBodySpec; position: [number, number, number]; velocity: [number, number, number]; sleeping: boolean }>()
  private ground: StaticPlaneSpec = { height: 0, restitution: 0.3, friction: 0.6 }
  private initial: RigidBodySpec[] = []

  addBody(spec: RigidBodySpec): void {
    this.initial.push({ ...spec })
    this.bodies.set(spec.id, {
      spec: { ...spec },
      position: [...spec.position],
      velocity: [...(spec.velocity ?? [0, 0, 0])],
      sleeping: false
    })
  }

  addGround(plane: StaticPlaneSpec): void {
    this.ground = { ...plane }
  }

  removeBody(id: string): void {
    this.bodies.delete(id)
  }

  step(dt: number): number {
    const started = performance.now()
    for (const body of this.bodies.values()) {
      if (body.sleeping) continue
      body.velocity[1] -= 9.81 * dt
      body.velocity[0] *= 1 - (body.spec.linearDamping ?? 0) * dt
      body.velocity[2] *= 1 - (body.spec.linearDamping ?? 0) * dt
      for (let axis = 0; axis < 3; axis += 1) body.position[axis] += body.velocity[axis] * dt
      const halfHeight = body.spec.shape === 'sphere' ? (body.spec.radius ?? 0.5) : (body.spec.halfExtents?.[1] ?? 0.5)
      const floor = this.ground.height + halfHeight
      if (body.position[1] < floor) {
        body.position[1] = floor
        if (Math.abs(body.velocity[1]) > 0.8) body.velocity[1] = Math.abs(body.velocity[1]) * (body.spec.restitution ?? this.ground.restitution ?? 0.3)
        else body.velocity[1] = 0
        const friction = Math.min(0.95, (body.spec.friction ?? this.ground.friction ?? 0.6) * dt * 6)
        body.velocity[0] *= 1 - friction
        body.velocity[2] *= 1 - friction
        if (Math.hypot(body.velocity[0], body.velocity[1], body.velocity[2]) < 0.05) {
          body.velocity = [0, 0, 0]
          body.sleeping = true
        }
      }
    }
    return performance.now() - started
  }

  snapshots(): RigidBodySnapshot[] {
    return [...this.bodies.entries()].map(([id, body]) => ({
      id,
      position: [...body.position],
      rotation: [0, 0, 0, 1],
      sleeping: body.sleeping
    }))
  }

  bodyCount(): number {
    return this.bodies.size
  }

  reset(): void {
    this.bodies.clear()
    for (const spec of this.initial) {
      this.bodies.set(spec.id, {
        spec: { ...spec },
        position: [...spec.position],
        velocity: [...(spec.velocity ?? [0, 0, 0])],
        sleeping: false
      })
    }
  }

  dispose(): void {
    this.bodies.clear()
    this.initial = []
  }
}

class RapierRigidWorld implements PhysicsWorld {
  readonly backend = 'rapier' as const
  private world: InstanceType<RapierModule['World']>
  private rapier: RapierModule
  private ids = new Map<string, { body: InstanceType<RapierModule['RigidBody']>; collider: InstanceType<RapierModule['Collider']>; spec: RigidBodySpec }>()
  private initial: RigidBodySpec[] = []
  private groundBody: InstanceType<RapierModule['RigidBody']> | null = null
  private groundDesc: StaticPlaneSpec | null = null

  constructor(rapier: RapierModule) {
    this.rapier = rapier
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = 1 / 60
  }

  addGround(plane: StaticPlaneSpec): void {
    if (this.groundBody) this.world.removeRigidBody(this.groundBody)
    this.groundDesc = { ...plane }
    const bodyDesc = this.rapier.RigidBodyDesc.fixed().setTranslation(0, plane.height, 0)
    this.groundBody = this.world.createRigidBody(bodyDesc)
    const collider = this.rapier.ColliderDesc.cuboid(500, 0.5, 500)
      .setRestitution(plane.restitution ?? 0.3)
      .setFriction(plane.friction ?? 0.6)
    this.world.createCollider(collider, this.groundBody)
  }

  addBody(spec: RigidBodySpec): void {
    this.initial.push({ ...spec })
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(spec.position[0], spec.position[1], spec.position[2])
      .setLinearDamping(spec.linearDamping ?? 0)
    if (spec.velocity) bodyDesc.setLinvel(spec.velocity[0], spec.velocity[1], spec.velocity[2])
    if (spec.mass && spec.mass > 0) bodyDesc.setAdditionalMass(spec.mass)
    const body = this.world.createRigidBody(bodyDesc)
    let colliderDesc: InstanceType<RapierModule['ColliderDesc']>
    if (spec.shape === 'sphere') colliderDesc = this.rapier.ColliderDesc.ball(spec.radius ?? 0.5)
    else {
      const half = spec.halfExtents ?? [0.5, 0.5, 0.5]
      colliderDesc = this.rapier.ColliderDesc.cuboid(half[0], half[1], half[2])
    }
    colliderDesc.setRestitution(spec.restitution ?? 0.3).setFriction(spec.friction ?? 0.6)
    const collider = this.world.createCollider(colliderDesc, body)
    this.ids.set(spec.id, { body, collider, spec })
  }

  removeBody(id: string): void {
    const entry = this.ids.get(id)
    if (!entry) return
    this.world.removeRigidBody(entry.body)
    this.ids.delete(id)
  }

  step(dt: number): number {
    const started = performance.now()
    this.world.timestep = dt
    this.world.step()
    return performance.now() - started
  }

  snapshots(): RigidBodySnapshot[] {
    const result: RigidBodySnapshot[] = []
    for (const [id, entry] of this.ids) {
      const t = entry.body.translation()
      const r = entry.body.rotation()
      result.push({ id, position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w], sleeping: entry.body.isSleeping() })
    }
    return result
  }

  bodyCount(): number {
    return this.ids.size
  }

  reset(): void {
    for (const id of [...this.ids.keys()]) this.removeBody(id)
    for (const spec of this.initial) this.addBody(spec)
    if (this.groundDesc) this.addGround(this.groundDesc)
  }

  dispose(): void {
    this.world.free()
    this.ids.clear()
    this.initial = []
    this.groundBody = null
  }
}

export async function createPhysicsWorld(ground?: StaticPlaneSpec): Promise<PhysicsWorld> {
  const rapier = await loadRapier()
  const world: PhysicsWorld = rapier ? new RapierRigidWorld(rapier) : new AnalyticRigidWorld()
  if (ground) world.addGround(ground)
  return world
}
