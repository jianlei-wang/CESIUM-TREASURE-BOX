precision highp float;
precision highp int;
#define SMAA_THRESHOLD 0.05
#define SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR 2
#define SMAA_USE_COLOR_EDGE_DETECTION 1
uniform sampler2D inputColorTexture;
in vec2 v_textureCoordinates;
in vec4 fOffset[3];
vec4 SMAAColorEdgeDetectionPS( vec2 texcoord, vec4 offset[3]) {
vec2 threshold = vec2( SMAA_THRESHOLD, SMAA_THRESHOLD );
vec4 delta;
vec3 C = texture( inputColorTexture, texcoord ).rgb;
vec3 Cleft = texture( inputColorTexture, offset[0].xy ).rgb;
vec3 t = abs( C - Cleft );
delta.x = max( max( t.r, t.g ), t.b );
vec3 Ctop = texture( inputColorTexture, offset[0].zw ).rgb;
t = abs( C - Ctop );
delta.y = max( max( t.r, t.g ), t.b );
vec2 edges = step( threshold, delta.xy );
vec3 Cright = texture( inputColorTexture, offset[1].xy ).rgb;
vec3 Cbottom  = texture( inputColorTexture, offset[1].zw ).rgb;
vec3 Cleftleft  = texture( inputColorTexture, offset[2].xy ).rgb;
vec3 Ctoptop = texture( inputColorTexture, offset[2].zw ).rgb;
if ( dot( edges, vec2( 1.0, 1.0 ) ) == 0.0 )
discard;
t = abs( C - Cright );
delta.z = max( max( t.r, t.g ), t.b );
t = abs( C - Cbottom );
delta.w = max( max( t.r, t.g ), t.b );
float maxDelta = max( max( max( delta.x, delta.y ), delta.z ), delta.w );
t = abs( C - Cleftleft );
delta.z = max( max( t.r, t.g ), t.b );
t = abs( C - Ctoptop );
delta.w = max( max( t.r, t.g ), t.b );
maxDelta = max( max( maxDelta, delta.z ), delta.w );
edges.xy *= step( maxDelta, float(SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR) * delta.xy );
return vec4( edges, 0.0, 0.0 );
}
void main()
{
out_FragColor = SMAAColorEdgeDetectionPS( v_textureCoordinates, fOffset);
}
