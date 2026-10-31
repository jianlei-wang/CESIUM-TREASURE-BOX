precision highp float;
precision highp int;
#define SMAA_DEBUG_SPLIT_VIEW 0
uniform vec2 u_resolution;
uniform sampler2D tBlendWeights;
uniform sampler2D tColor;
in vec2 v_textureCoordinates;
in vec4 fOffset[2];
vec4 SMAANeighborhoodBlendingPS( vec2 texcoord, vec4 inOffset[ 2 ] ) {
vec4 a;
a.xz = texture( tBlendWeights, texcoord ).xz;
a.y = texture( tBlendWeights, inOffset[ 1 ].zw ).g;
a.w = texture( tBlendWeights, inOffset[ 1 ].xy ).a;
vec4 currentColor =  texture( tColor, texcoord, 0.0 );
vec2 offset;
offset.x = a.a > a.b ? a.a : -a.b;
offset.y = a.g > a.r ? -a.g : a.r;
if ( abs( offset.x ) > abs( offset.y )) {
offset.y = 0.0;
} else {
offset.x = 0.0;
}
vec4 C = currentColor;
texcoord += sign( offset ) * u_resolution;
vec4 Cop = texture( tColor, texcoord, 0.0 );
float s = abs( offset.x ) > abs( offset.y ) ? abs( offset.x ) : abs( offset.y );
C.xyz = pow(C.xyz, vec3(2.2));
Cop.xyz = pow(Cop.xyz, vec3(2.2));
vec4 mixed = mix(C, Cop, s);
mixed.xyz = pow(mixed.xyz, vec3(1.0 / 2.2));
if ( dot(a, vec4( 1.0, 1.0, 1.0, 1.0 )) < 1e-5 ) {
return currentColor;
} else {
return mixed;
}
}
void main()
{
out_FragColor = SMAANeighborhoodBlendingPS( v_textureCoordinates, fOffset);
}
