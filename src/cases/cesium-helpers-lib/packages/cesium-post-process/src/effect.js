/**
 * A screen-space effect: a post-process stage on a scene while active.
 * Subclasses create their stage in `createStage_` and take their side effects
 * in `activated_` and `deactivating_`.
 */
export default class Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   */
  constructor(viewer) {
    this.viewer = viewer;
    /** @type {import('@cesium/engine').PostProcessStage | import('@cesium/engine').PostProcessStageComposite | undefined} */
    this.stage_ = undefined;
  }

  get active() {
    return this.stage_ !== undefined;
  }

  set active(active) {
    const scene = this.viewer.scene;
    if (active) {
      if (this.stage_) {
        return;
      }
      this.stage_ = this.createStage_(scene);
      scene.postProcessStages.add(this.stage_);
      this.activated_(scene);
    } else {
      if (!this.stage_) {
        return;
      }
      this.deactivating_(scene);
      // removing a stage also destroys it
      scene.postProcessStages.remove(this.stage_);
      this.stage_ = undefined;
    }
    scene.requestRender();
  }

  /**
   * @param {import('@cesium/engine').Scene} _scene
   * @return {import('@cesium/engine').PostProcessStage | import('@cesium/engine').PostProcessStageComposite}
   */
  createStage_(_scene) {
    throw new Error(`${this.constructor.name} does not implement createStage_`);
  }

  /**
   * Called once the stage is added to the scene.
   * @param {import('@cesium/engine').Scene} _scene
   */
  activated_(_scene) {}

  /**
   * Called before the stage is removed from the scene.
   * @param {import('@cesium/engine').Scene} _scene
   */
  deactivating_(_scene) {}

  destroy() {
    this.active = false;
  }
}
