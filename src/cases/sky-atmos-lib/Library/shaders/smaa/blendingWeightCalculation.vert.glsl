precision highp float;
precision highp int;
#define SMAA_MAX_SEARCH_STEPS 8
in vec4 aPosition;
in vec2 textureCoordinates;
uniform vec2 u_resolution;
out vec2 v_textureCoordinates;
out vec4 fOffset[3];
out vec2 fPixCoord;
void SMAABlendingWeightCalculationVS( vec2 texcoord ) {
fPixCoord = texcoord / u_resolution;
fOffset[ 0 ] = texcoord.xyxy + u_resolution.xyxy * vec4( -0.25, 0.125, 1.25, 0.125 );
fOffset[ 1 ] = texcoord.xyxy + u_resolution.xyxy * vec4( -0.125, 0.25, -0.125, -1.25 );
fOffset[ 2 ] = vec4( fOffset[ 0 ].xz, fOffset[ 1 ].yw ) + vec4( -2.0, 2.0, -2.0, 2.0 ) * u_resolution.xxyy * float( SMAA_MAX_SEARCH_STEPS );
}
void main()
{
gl_Position = aPosition;
v_textureCoordinates = textureCoordinates;
SMAABlendingWeightCalculationVS( textureCoordinates );
}
