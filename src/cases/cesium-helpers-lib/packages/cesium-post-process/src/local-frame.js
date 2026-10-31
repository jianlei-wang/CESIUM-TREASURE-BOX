import {Cartesian3, FixedFrameTransforms, Matrix4} from '@cesium/core';

/**
 * The local frame's coordinates from the eye's, for a shader that wants a pixel's place in a small frame (east-north-up about a point) to
 * lay a pattern over the ground that stays where it is as the camera moves. Made in double precision on the CPU: the globe's offset
 * (about 6.4 million meters) cancels in the product, so the matrix a shader gets is small and a place comes out to the millimeter. In world
 * coordinates, a single precision float steps by half a meter.
 * @param {Matrix4} frame The local frame in the world, such as `FixedFrameTransforms.eastNorthUpToFixedFrame(origin)`.
 * @param {Matrix4} viewMatrix The camera's view matrix.
 * @param {Matrix4} [result]
 * @return {Matrix4}
 */
export function localFromEye(frame, viewMatrix, result = new Matrix4()) {
  return Matrix4.inverseTransformation(Matrix4.multiply(viewMatrix, frame, result), result);
}

/**
 * A local frame, east-north-up about an origin, for an effect that lays a pattern over the ground: the origin given, or the camera's
 * position when the frame is first anchored.
 */
export class LocalFrame {
  /** @param {Cartesian3} [origin] */
  constructor(origin) {
    this.origin_ = origin && Cartesian3.clone(origin);
    /** @type {Matrix4 | undefined} */
    this.frame_ = undefined;
    this.scratch_ = new Matrix4();
  }

  /** The point of the world the frame is laid about; undefined until anchored if none was given. */
  get origin() {
    return this.origin_;
  }

  set origin(value) {
    this.origin_ = value && Cartesian3.clone(value);
    this.frame_ = undefined;
  }

  /**
   * The origin, the camera's position if there is none yet.
   * @param {import('@cesium/engine').Scene} scene
   */
  anchor(scene) {
    this.origin_ ??= Cartesian3.clone(scene.camera.positionWC);
    return this.origin_;
  }

  /**
   * The local frame's coordinates from the camera's eye's (localFromEye), anchored first.
   * @param {import('@cesium/engine').Scene} scene
   */
  fromEye(scene) {
    this.frame_ ??= FixedFrameTransforms.eastNorthUpToFixedFrame(this.anchor(scene), scene.ellipsoid, new Matrix4());
    return localFromEye(this.frame_, scene.camera.viewMatrix, this.scratch_);
  }
}
