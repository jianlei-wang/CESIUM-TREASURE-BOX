import {Cartesian3, Matrix4} from '@cesium/core';

const upScratch = new Cartesian3();
const surfaceScratch = new Cartesian3();

/**
 * The uniforms of Height.glsl: the camera's height, the local up direction in
 * eye coordinates and the Earth's radius below the camera, in double precision.
 * @param {import('@cesium/engine').Scene} scene
 */
export function heightUniforms(scene) {
  return {
    cameraHeight: () => scene.camera.positionCartographic.height,
    up: () => {
      const up = scene.ellipsoid.geodeticSurfaceNormal(scene.camera.positionWC, upScratch);
      return Matrix4.multiplyByPointAsVector(scene.camera.viewMatrix, up, up);
    },
    radius: () => {
      const surface = scene.ellipsoid.scaleToGeodeticSurface(scene.camera.positionWC, surfaceScratch);
      return surface ? Cartesian3.magnitude(surface) : scene.ellipsoid.maximumRadius;
    },
  };
}
