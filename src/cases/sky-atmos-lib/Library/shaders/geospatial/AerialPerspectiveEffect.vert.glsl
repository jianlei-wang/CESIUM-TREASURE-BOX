
    #version 300 es 
    precision highp float;
    precision highp int;
    precision highp sampler2D;
    precision highp samplerCube;
    precision highp sampler3D;
    precision highp sampler2DArray;
    precision highp sampler2DShadow;
    precision highp samplerCubeShadow;
    precision highp sampler2DArrayShadow;
    precision highp isampler2D;
    precision highp isampler3D;
    precision highp isamplerCube;
    precision highp isampler2DArray;
    precision highp usampler2D;
    precision highp usampler3D;
    precision highp usamplerCube;
    precision highp usampler2DArray;
    in vec3 position;
    out vec2 v_textureCoordinates;
    uniform mat4 inverseViewMatrix;
    uniform mat4 inverseProjectionMatrix;
    uniform vec3 cameraPosition;
    uniform vec3 ellipsoidCenter;
    uniform mat4 inverseEllipsoidMatrix;
    uniform vec3 altitudeCorrection;
    uniform vec3 ellipsoidRadii;
    uniform float idealSphereAlpha;
    
    out vec3 vCameraPosition;
    out vec3 vRayDirection;
    out vec3 vEllipsoidCenter;
    out vec3 vGeometryEllipsoidCenter;
    out vec3 vEllipsoidRadiiSquared;
    
    void getCameraRay(out vec3 origin, out vec3 direction) {
        bool isPerspective = inverseProjectionMatrix[2][3] != 0.0; // 4th entry in the 3rd column
        if (isPerspective) {
            // Calculate the camera ray for a perspective camera.
            vec4 viewPosition = inverseProjectionMatrix * vec4(position, 1.0);
            vec4 worldDirection = inverseViewMatrix * vec4(viewPosition.xyz, 0.0);
            origin = cameraPosition;
            direction = worldDirection.xyz;
        } else {
            // Unprojected points to calculate direction.
            vec4 nearPoint = inverseProjectionMatrix * vec4(position.xy, -1.0, 1.0);
            vec4 farPoint = inverseProjectionMatrix * vec4(position.xy, -0.9, 1.0);
            nearPoint /= nearPoint.w;
            farPoint /= farPoint.w;
        
            // Calculate world values.
            vec4 worldDirection = inverseViewMatrix * vec4(farPoint.xyz - nearPoint.xyz, 0.0);
            vec4 worldOrigin = inverseViewMatrix * nearPoint;
        
            // Outputs
            direction = worldDirection.xyz;
            origin = worldOrigin.xyz;
        }
    }
    
    void main() {
        vec3 direction, origin;
        getCameraRay(origin, direction);
        
        mat3 rotation = mat3(inverseEllipsoidMatrix);
        vCameraPosition = rotation * origin.xyz * METER_TO_LENGTH_UNIT;
        vRayDirection = rotation * direction.xyz;
        
        vEllipsoidCenter = (ellipsoidCenter + altitudeCorrection) * METER_TO_LENGTH_UNIT;
        #ifdef CORRECT_GEOMETRIC_ERROR
            // Gradually turn off altitude correction for aerial perspective as geometric
            // error correction takes effect.
            // See: https://github.com/takram-design-engineering/three-geospatial/pull/23#issuecomment-2542914656
            vGeometryEllipsoidCenter =
                (ellipsoidCenter + mix(altitudeCorrection, vec3(0.0), idealSphereAlpha)) * METER_TO_LENGTH_UNIT;
        #else
            vGeometryEllipsoidCenter = vEllipsoidCenter;
        #endif // CORRECT_GEOMETRIC_ERROR
        
        vec3 radii = ellipsoidRadii * METER_TO_LENGTH_UNIT;
        vEllipsoidRadiiSquared = radii * radii;

        gl_Position = vec4(position.xy, 1.0, 1.0);
        v_textureCoordinates = position.xy*0.5+0.5;
    }
  