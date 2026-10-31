#version 300 es
precision highp float;

layout(location = 0) in vec3 position;
uniform mat4 u_volumetricLightInverseProjection;
uniform mat4 u_volumetricLightInverseView;
uniform mat4 u_volumetricLightInverseEllipsoid;
uniform vec3 u_volumetricLightCamera;
uniform vec3 u_volumetricLightCenter;
out vec2 vUv;
out vec3 vFogCamera;
out vec3 vFogRay;

void main() {
    vUv = position.xy * 0.5 + 0.5;
    vec4 eyeRay = u_volumetricLightInverseProjection * vec4(position.xy, 1.0, 1.0);
    mat3 rotation = mat3(u_volumetricLightInverseEllipsoid);
    vFogCamera = rotation * u_volumetricLightCamera - u_volumetricLightCenter;
    vFogRay = rotation * (u_volumetricLightInverseView * vec4(eyeRay.xyz, 0.0)).xyz;
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
