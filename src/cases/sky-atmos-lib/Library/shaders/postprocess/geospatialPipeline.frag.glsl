

            uniform sampler2D inputBuffer;
            uniform sampler2D u_accumulation;
            uniform sampler2D u_revealage;
            uniform float cameraHeight;
            uniform float toneMappingExposure;
            uniform vec3 sunPositionWC;
            #ifdef ENABLE_FIELDS
                uniform sampler2D viewsheSpotsTexture;
                uniform float u_transparency;
                uniform vec4 u_color1;
                uniform vec4 u_color2;
            #endif
            in vec2 v_textureCoordinates;
            #define TONE_MAPPING_MODE __TONE_MAPPING_MODE__
            #define DITHERING
            vec4 LinearTransferOETF( in vec4 value ) {
                return value;
            }
            vec4 sRGBTransferEOTF( in vec4 value ) {
                return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
            }
            vec4 sRGBTransferOETF( in vec4 value ) {
                return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
            }
            vec4 linearToOutputTexel( vec4 value ) {
                return sRGBTransferOETF( vec4( value.rgb * mat3( 1.0000, -0.0000, -0.0000, -0.0000, 1.0000, 0.0000, 0.0000, 0.0000, 1.0000 ), value.a ) );
            }
            float luminance( const in vec3 rgb ) {
                const vec3 weights = vec3( 0.2126, 0.7152, 0.0722 );
                return dot( weights, rgb );
            }
            #define PI 3.141592653589793
            #define PI2 6.283185307179586
            #define PI_HALF 1.5707963267948966
            #define RECIPROCAL_PI 0.3183098861837907
            #define RECIPROCAL_PI2 0.15915494309189535
            #define EPSILON 1e-6
            #ifndef saturate
                #define saturate( a ) clamp( a, 0.0, 1.0 )
            #endif
            #define whiteComplement( a ) ( 1.0 - saturate( a ) )
            highp float rand( const in vec2 uv ) {
                const highp float a = 12.9898, b = 78.233, c = 43758.5453;
                highp float dt = dot( uv.xy, vec2( a, b ) ), sn = mod( dt, PI );
                return fract( sin( sn ) * c );
            }
            const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
            vec3( 1.6605, - 0.1246, - 0.0182 ), vec3( - 0.5876, 1.1329, - 0.1006 ), vec3( - 0.0728, - 0.0083, 1.1187 )
            );
            const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
            vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 )
            );
            vec3 agxDefaultContrastApprox( vec3 x ) {
                vec3 x2 = x * x;
                vec3 x4 = x2 * x2;
                return + 15.5 * x4 * x2
                - 40.14 * x4 * x
                + 31.96 * x4
                - 6.868 * x2 * x
                + 0.4298 * x2
                + 0.1191 * x
                - 0.00232;
            }
            vec3 AgXToneMapping( vec3 color ) {
                const mat3 AgXInsetMatrix = mat3(
                vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ), vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
                );
                const mat3 AgXOutsetMatrix = mat3(
                vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ), vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ), vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
                );
                const float AgxMinEv = - 12.47393;
                const float AgxMaxEv = 4.026069;
                color *= toneMappingExposure;
                color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
                color = AgXInsetMatrix * color;
                color = max( color, 1e-10 );
                color = log2( color );
                color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
                color = clamp( color, 0.0, 1.0 );
                color = agxDefaultContrastApprox( color );
                color = AgXOutsetMatrix * color;
                color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
                color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
                color = clamp( color, 0.0, 1.0 );
                return color;
            }
            vec3 RRTAndODTFit( vec3 v ) {
                vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
                vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
                return a / b;
            }
            vec3 ACESFilmicToneMapping( vec3 color ) {
                const mat3 ACESInputMat = mat3(
                vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 )
                );
                const mat3 ACESOutputMat = mat3(
                vec3(  1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 )
                );
                color *= toneMappingExposure / 0.6;
                color = ACESInputMat * color;
                color = RRTAndODTFit( color );
                color = ACESOutputMat * color;
                return saturate( color );
            }
            vec3 NeutralToneMapping( vec3 color ) {
                const float StartCompression = 0.8 - 0.04;
                const float Desaturation = 0.15;
                color *= toneMappingExposure;
                float x = min( color.r, min( color.g, color.b ) );
                float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
                color -= offset;
                float peak = max( color.r, max( color.g, color.b ) );
                if ( peak < StartCompression ) return color;
                float d = 1. - StartCompression;
                float newPeak = 1. - d * d / ( peak + d - StartCompression );
                color *= newPeak / peak;
                float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
                return mix( color, vec3( newPeak ), g );
            }
            uniform float WhitePoint;
            #if TONE_MAPPING_MODE == 2 || TONE_MAPPING_MODE == 3
                uniform float MiddleGrey;
                #if TONE_MAPPING_MODE == 3
                    uniform lowp sampler2D LuminanceBuffer;
                #else
                    uniform float AverageLuminance;
                #endif
                vec3 Reinhard2ToneMapping(vec3 color) {
                    color *= toneMappingExposure;
                    float l = luminance(color);
                    #if TONE_MAPPING_MODE == 3
                        float lumAvg = unpackRGBAToFloat(texture2D(LuminanceBuffer, vec2(0.5)));
                    #else
                        float lumAvg = AverageLuminance;
                    #endif
                    float lumScaled = (l*MiddleGrey)/max(lumAvg, 1e-6);
                    float lumCompressed = lumScaled*(1.0+lumScaled/(WhitePoint*WhitePoint));
                    lumCompressed /= (1.0+lumScaled);
                    return clamp(lumCompressed*color, 0.0, 1.0);
                }
            #elif TONE_MAPPING_MODE == 4
                #define A 0.15
                #define B 0.50
                #define C 0.10
                #define D 0.20
                #define E 0.02
                #define F 0.30
                vec3 Uncharted2Helper(const in vec3 x) {
                    return((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
                }
                vec3 Uncharted2ToneMapping(vec3 color) {
                    color *= toneMappingExposure;
                    return clamp(Uncharted2Helper(color)/Uncharted2Helper(vec3(WhitePoint)), 0.0, 1.0);
                }
            #endif
            vec3 LinearToneMapping( vec3 color ) {
                return saturate( toneMappingExposure * color );
            }
            vec3 ReinhardToneMapping( vec3 color ) {
                color *= toneMappingExposure;
                return saturate( color / ( vec3( 1.0 ) + color ) );
            }
            vec3 CineonToneMapping( vec3 color ) {
                color *= toneMappingExposure;
                color = max( vec3( 0.0 ), color - 0.004 );
                return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
            }
            void ToneMapMain(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
                #if TONE_MAPPING_MODE == 2 || TONE_MAPPING_MODE == 3
                    outputColor = vec4(Reinhard2ToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 4
                    outputColor = vec4(Uncharted2ToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 7
                    outputColor = vec4(AgXToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 8
                    outputColor = vec4(NeutralToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 9
                    outputColor = vec4(ACESFilmicToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 10
                    outputColor = vec4(LinearToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 11
                    outputColor = vec4(ReinhardToneMapping(inputColor.rgb), inputColor.a);
                #elif TONE_MAPPING_MODE == 12
                    outputColor = vec4(CineonToneMapping(inputColor.rgb), inputColor.a);
                #endif
            }
            vec4 blend30(const in vec4 x, const in vec4 y, const in float opacity) {
                return y;
            }
            #ifdef DITHERING
                vec3 dithering( vec3 color ) {
                    float grid_position = rand( gl_FragCoord.xy );
                    vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
                    dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
                    return color + dither_shift_RGB;
                }
            #endif
            void DITMain(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {
                outputColor = vec4(saturate(dithering(inputColor.rgb)), inputColor.a);
            }
            vec4 blend23(const in vec4 x, const in vec4 y, const in float opacity) {
                return mix(x, y, opacity);
            }
            #ifdef ENABLE_SSR
                #define REFLECTION_SAMPLES 64
                #define RIGHT_HANDED_SCENE
                uniform sampler2D czm_reflectivityTexture;
                uniform sampler2D czm_normalTexture;
                uniform sampler2D czm_positionTexture;
                uniform vec4 ssrParam;
                vec3 fresnelSchlick(float cosTheta, vec3 F0) {
                    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
                }

                vec3 hash(vec3 a) {
                    a = fract(a * 0.8);
                    a += dot(a, a.yxz + 19.19);
                    return fract((a.xxy + a.yxx) * a.zyx);
                }

                vec4 applyProjectionMat(mat4 projectionMat, vec3 x) {
                    vec4 projectedCoord = projectionMat * vec4(x, 1.0);
                    projectedCoord.xy /= projectedCoord.w;
                    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;
                    return projectedCoord;
                }

                vec3 screenSpaceIntersection(vec3 dir, vec3 startPosition, vec3 viewDir) {
                    vec3 viewPos = startPosition;
                    vec4 projectedCoordStart = applyProjectionMat(czm_projection, viewPos);
                    vec3 Q0 = viewPos / projectedCoordStart.w;
                    float k0 = 1.0 / projectedCoordStart.w;

                    viewPos += dir;
                    vec4 projectedCoordVanishingPoint = applyProjectionMat(czm_projection, dir);
                    vec4 projectedCoordEnd = applyProjectionMat(czm_projection, viewPos);
                    vec3 Q1 = viewPos / projectedCoordEnd.w;
                    float k1 = 1.0 / projectedCoordEnd.w;

                    vec2 projectedCoordDir = projectedCoordEnd.xy - projectedCoordStart.xy;
                    vec2 projectedCoordDistVanishingPoint = projectedCoordVanishingPoint.xy - projectedCoordStart.xy;
                    float rayScale = min(
                        max(abs(projectedCoordDistVanishingPoint.x), abs(projectedCoordDistVanishingPoint.y)),
                        1.0
                    );
                    float projectedCoordDirLength = max(length(projectedCoordDir), 1e-5);
                    float maxSt = float(REFLECTION_SAMPLES);

                    vec2 dP = rayScale * projectedCoordDir / (maxSt * projectedCoordDirLength);
                    vec3 dQ = rayScale * (Q1 - Q0) / (maxSt * projectedCoordDirLength);
                    float dk = rayScale * (k1 - k0) / (maxSt * projectedCoordDirLength);

                    vec2 P = projectedCoordStart.xy;
                    vec3 Q = Q0;
                    float k = k0;
                    float rayStartZ = -startPosition.z;
                    float rayEndZ = -startPosition.z;
                    float prevEstimateZ = -startPosition.z;
                    float rayDiffZ = 0.0;
                    float dDepth;
                    float depth;
                    float invResolutionWidth = 1.0 / czm_viewport.z;
                    float invResolutionHeight = 1.0 / czm_viewport.w;

                    for (int i = 0; i < REFLECTION_SAMPLES - 1; i++) {
                        depth = -texelFetch(czm_positionTexture, ivec2(P * czm_viewport.zw), 0).z;
                        rayStartZ = prevEstimateZ;
                        dDepth = -rayStartZ - depth;
                        rayEndZ = (dQ.z * 0.5 + Q.z) / ((dk * 0.5 + k));
                        rayDiffZ = rayEndZ - rayStartZ;
                        prevEstimateZ = rayEndZ;

                        if (-rayEndZ > czm_currentFrustum.y ||
                            -rayEndZ < czm_currentFrustum.x ||
                            P.x < 0.0 || P.x > 1.0 ||
                            P.y < 0.0 || P.y > 1.0) {
                            return vec3(P, 0.0);
                        }

                        if (dDepth < 0.025 / max(abs(k), 1e-5) + abs(rayDiffZ) &&
                            dDepth > 0.0 &&
                            depth > czm_currentFrustum.x &&
                            depth < czm_currentFrustum.y &&
                            (abs(P.x - projectedCoordStart.x) > invResolutionWidth ||
                                abs(P.y - projectedCoordStart.y) > invResolutionHeight)) {
                            return vec3(P, depth);
                        }

                        P = clamp(P + dP, vec2(0.0), vec2(0.999));
                        Q.z += dQ.z;
                        k += dk;
                    }

                    P = P - dP;
                    return vec3(P, 0.0);
                }

                void SSR(in vec4 sceneColor) {

                    vec3 albedo = sceneColor.rgb;
                    float spec = texelFetch(czm_normalTexture, ivec2(v_textureCoordinates * czm_viewport.zw), 0).w;
                    
                    float roughness = 1.0 - spec;
                    if (roughness > 0.99) {
                        out_FragColor = sceneColor;
                        return;
                    }

                    vec3 normal = texelFetch(czm_normalTexture, ivec2(v_textureCoordinates * czm_viewport.zw), 0).xyz;
                    vec3 position = texelFetch(czm_positionTexture, ivec2(v_textureCoordinates * czm_viewport.zw), 0).xyz;

                    vec3 reflected = normalize(reflect(normalize(position), normalize(normal)));
                    vec3 viewDir = normalize(position);

                    vec3 jitt = mix(vec3(0.0), hash(position), roughness) * ssrParam.y;
                    vec3 hitCoordinate = screenSpaceIntersection(reflected + jitt, position, viewDir);

                    if (hitCoordinate.x < 0.998 && hitCoordinate.x > 0.002 &&
                        hitCoordinate.y < 0.998 && hitCoordinate.y > 0.002) {
                        float specValue = 1.0 - roughness;
                        vec3 F0 = vec3(0.04);
                        F0 = mix(F0, albedo, specValue);

                        vec3 fresnel = fresnelSchlick(max(dot(normalize(normal), viewDir), 0.0), F0);

                        #ifdef RIGHT_HANDED_SCENE
                            reflected.z *= -1.0;
                        #endif

                        vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - hitCoordinate.xy));
                        float screenEdgefactor = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);
                        // Keep the current side-view response, but add a small floor so
                        // front-facing views can still retain some reflection.
                        float viewFacing = clamp(dot(normalize(normal), normalize(-position)), 0.0, 1.0);
                        float frontalReflectionBoost = 0.18 * smoothstep(0.85, 1.0, viewFacing);
                        float reflectionFacing = max(reflected.z, frontalReflectionBoost);

                        float reflectionMultiplier = clamp(
                            pow(specValue * ssrParam.x, ssrParam.z) *
                            screenEdgefactor *
                            reflectionFacing,
                            0.0,
                            0.9
                        );
                        float albedoMultiplier = 1.0 - reflectionMultiplier;

                        vec2 texCoord = clamp(hitCoordinate.xy, vec2(0.0), vec2(1.0));
                        vec3 curColor = texelFetch(inputBuffer, ivec2(texCoord * czm_viewport.zw), 0).rgb;
                        vec3 ssr = curColor * fresnel;

                        out_FragColor = vec4((albedo * albedoMultiplier) + (ssr * reflectionMultiplier), sceneColor.a);
                    } else {
                        out_FragColor = vec4(albedo, sceneColor.a);
                    }
                }
            #endif
            void main() {
                // tonemap
                vec4 color0 = texture(inputBuffer, v_textureCoordinates);
                vec4 color1 = vec4(0.0);
                ToneMapMain(color0, v_textureCoordinates, color1);
                color0 = blend30(color0, color1, 1.0);
                color0.a = clamp(color0.a, 0.0, 1.0);
                // This custom stage runs after Cesium's tonemapper; encode its linear output once.
                color0.rgb = czm_inverseGamma(color0.rgb);

                DITMain(color0, v_textureCoordinates, color1);
                color0 = blend23(color0, color1, 1.0);
                color0.a = clamp(color0.a, 0.0, 1.0);
                out_FragColor = color0;
                // 视域协同特效 半透明优化
                #ifdef ENABLE_FIELDS
                    vec4 viewsheSpotColor = texture(viewsheSpotsTexture, v_textureCoordinates);
                    if(viewsheSpotColor.g>0.01){
                        out_FragColor = mix(out_FragColor, u_color2, u_transparency);
                    }
                    if(viewsheSpotColor.r>0.01){
                        out_FragColor = mix(out_FragColor, u_color1, u_transparency);
                    }
                #endif
                #ifdef HAS_GS_MASK
                    vec4 gsMask = texture(czm_gsMaskTexture, v_textureCoordinates);
                    if (gsMask.a > 0.5) {
                        out_FragColor.rgb *= gsMask.rgb;
                    }
                #endif 
                #ifdef ENABLE_SSR
                    SSR(out_FragColor);
                #endif
                // 渲染半透明物体，解决oit渲染没有深度的问题
                #ifdef ENABLE_TRANSLUCENT
                    vec3 sunDir = normalize(sunPositionWC);
                    vec3 viewDir = normalize(czm_viewerPositionWC);
                    float sunViewCosTheta = dot(viewDir, sunDir);
                    vec4 opaque = out_FragColor;
                    vec4 accum = texture(u_accumulation, v_textureCoordinates);
                    float r = texture(u_revealage, v_textureCoordinates).r;
                    vec4 transparent = vec4(accum.rgb / clamp(r, 1e-4, 5e4), accum.a);
                    transparent.rgb = transparent.rgb * mix(0.0, 1.0, step(0.0, sunViewCosTheta));
                    out_FragColor = (1.0 - transparent.a) * transparent + transparent.a * opaque;
                    if (opaque != czm_backgroundColor) {
                        out_FragColor.a = 1.0;
                    }
                #endif
                #ifdef ENCODE_OUTPUT
                    out_FragColor = linearToOutputTexel( out_FragColor );
                #endif
                #ifdef DITHERING
                    out_FragColor.rgb = dithering( out_FragColor.rgb );
                #endif
            }
            