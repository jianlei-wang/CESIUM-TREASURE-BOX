import {
  Math as CesiumMath,
  Cartesian3,
  Cartesian2,
  Ray,
} from "@cesium/core";
import {
  ScreenSpaceEventType,
} from "@cesium/engine";

const look3DStartPos = new Cartesian2();
const look3DEndPos = new Cartesian2();
const look3DStartRay = new Ray();
const look3DEndRay = new Ray();
const look3DNegativeRot = new Cartesian3();
const look3DTan = new Cartesian3();
const rotationAxisScratch = new Cartesian3();

export default class CesiumSphereCamera {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   */
  constructor(viewer) {
    this.viewer = viewer;
    this.dragging_ = false;
    this.active_ = false;

    this.handleDownEvent_ = this.handleDownEvent.bind(this);
    this.handleMoveEvent_ = this.handleMoveEvent.bind(this);
    this.handleUpEvent_ = this.handleUpEvent.bind(this);
  }

  get active() {
    return this.active_;
  }

  set active(active) {
    if (active === this.active_) {
      return;
    }
    this.active_ = active;
    this.viewer.scene.screenSpaceCameraController.enableInputs = !active;
    if (active) {
      this.viewer.screenSpaceEventHandler.setInputAction(this.handleDownEvent_, ScreenSpaceEventType.LEFT_DOWN);
      this.viewer.screenSpaceEventHandler.setInputAction(this.handleMoveEvent_, ScreenSpaceEventType.MOUSE_MOVE);
      this.viewer.screenSpaceEventHandler.setInputAction(this.handleUpEvent_, ScreenSpaceEventType.LEFT_UP);
    } else {
      this.viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOWN);
      this.viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
      this.viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_UP);
    }
  }

  handleDownEvent() {
    this.dragging_ = true;
  }

  /**
   * Code from look3D function in ScreenSpaceCameraController
   * @param {import('@cesium/engine').ScreenSpaceEventHandler.MotionEvent} movement
   */
  handleMoveEvent(movement) {
    if (!this.dragging_) {
      return;
    }
    const camera = this.viewer.scene.camera;

    // x axis

    let angle = 0.0;
    look3DStartPos.x = movement.startPosition.x;
    look3DStartPos.y = 0.0;
    look3DEndPos.x = movement.endPosition.x;
    look3DEndPos.y = 0.0;

    camera.getPickRay(look3DStartPos, look3DStartRay);
    camera.getPickRay(look3DEndPos, look3DEndRay);

    let dot = Cartesian3.dot(look3DStartRay.direction, look3DEndRay.direction);
    if (dot < 1.0) {
      // dot is in [0, 1]
      angle = Math.acos(dot);
    }
    angle = movement.startPosition.x > movement.endPosition.x ? -angle : angle;
    const rotationAxis =
      this.viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(camera.position, rotationAxisScratch);
    camera.look(rotationAxis, -angle);

    // y axis

    look3DStartPos.x = 0.0;
    look3DStartPos.y = movement.startPosition.y;
    look3DEndPos.x = 0.0;
    look3DEndPos.y = movement.endPosition.y;

    camera.getPickRay(look3DStartPos, look3DStartRay);
    camera.getPickRay(look3DEndPos, look3DEndRay);
    angle = 0.0;

    dot = Cartesian3.dot(look3DStartRay.direction, look3DEndRay.direction);
    if (dot < 1.0) {
      // dot is in [0, 1]
      angle = Math.acos(dot);
    }
    angle = movement.startPosition.y > movement.endPosition.y ? -angle : angle;
    const direction = camera.direction;
    const negativeRotationAxis = Cartesian3.negate(
      rotationAxis,
      look3DNegativeRot
    );
    const northParallel = Cartesian3.equalsEpsilon(
      direction,
      rotationAxis,
      CesiumMath.EPSILON2
    );
    const southParallel = Cartesian3.equalsEpsilon(
      direction,
      negativeRotationAxis,
      CesiumMath.EPSILON2
    );
    if (!northParallel && !southParallel) {
      dot = Cartesian3.dot(direction, rotationAxis);
      let angleToAxis = CesiumMath.acosClamped(dot);
      if (angle > 0 && angle > angleToAxis) {
        angle = angleToAxis - CesiumMath.EPSILON4;
      }

      dot = Cartesian3.dot(direction, negativeRotationAxis);
      angleToAxis = CesiumMath.acosClamped(dot);
      if (angle < 0 && -angle > angleToAxis) {
        angle = -angleToAxis + CesiumMath.EPSILON4;
      }

      const tangent = Cartesian3.cross(rotationAxis, direction, look3DTan);
      camera.look(tangent, angle);
    } else if ((northParallel && angle < 0) || (southParallel && angle > 0)) {
      camera.look(camera.right, -angle);
    }
  }

  handleUpEvent() {
    this.dragging_ = false;
  }
}
