precision highp float;
precision highp int;
#define SMAA_MAX_SEARCH_STEPS 8
#define SMAA_AREATEX_MAX_DISTANCE 16
#define SMAA_AREATEX_PIXEL_SIZE ( 1.0 / vec2( 160.0, 560.0 ) )
#define SMAA_AREATEX_SUBTEX_SIZE ( 1.0 / 7.0 )
uniform sampler2D tEdges;
uniform sampler2D tArea;
uniform sampler2D tSearch;
uniform vec2 u_resolution;
in vec2 v_textureCoordinates;
in vec4 fOffset[3];
in vec2 fPixCoord;
vec4 SMAASampleLevelZeroOffset(vec2 coord, ivec2 offset ){
return texture( tEdges, coord + float( offset ) * u_resolution, 0.0 );
}
vec2 myRound( vec2 x ) {
return sign( x ) * floor( abs( x ) + 0.5 );
}
float SMAASearchLength(vec2 e, float bias, float scale ) {
e.r = bias + e.r * scale;
return 255.0 * texture( tSearch, e, 0.0 ).r;
}
float SMAASearchXLeft(vec2 texcoord, float end ) {
vec2 e = vec2( 0.0, 1.0 );
bool found = false;
for ( int i = 0; i < SMAA_MAX_SEARCH_STEPS; i ++ ) {
vec2 pixel = texture( tEdges, texcoord, 0.0 ).rg;
if(!found){
texcoord -= vec2( 2.0, 0.0 ) * u_resolution;
e = pixel;
}
if(!found && ! ( texcoord.x > end && e.g > 0.8281 && e.r == 0.0 )){
found = true;
}
}
texcoord.x += 0.25 * u_resolution.x;
texcoord.x += u_resolution.x;
texcoord.x += 2.0 * u_resolution.x;
texcoord.x -= u_resolution.x * SMAASearchLength(e, 0.0, 0.5);
return texcoord.x;
}
float SMAASearchXRight(vec2 texcoord, float end ) {
vec2 e = vec2( 0.0, 1.0 );
bool found = false;
for ( int i = 0; i < SMAA_MAX_SEARCH_STEPS; i ++ ) {
vec2 pixel = texture( tEdges, texcoord, 0.0 ).rg;
if(!found){
texcoord += vec2( 2.0, 0.0 ) * u_resolution;
e = pixel;
}
if (!found && ! ( texcoord.x < end && e.g > 0.8281 && e.r == 0.0 ) )
{
found = true;
}
}
texcoord.x -= 0.25 * u_resolution.x;
texcoord.x -= u_resolution.x;
texcoord.x -= 2.0 * u_resolution.x;
texcoord.x += u_resolution.x * SMAASearchLength(e, 0.5, 0.5 );
return texcoord.x;
}
float SMAASearchYUp(vec2 texcoord, float end ) {
vec2 e = vec2( 1.0, 0.0 );
bool found = false;
for ( int i = 0; i < SMAA_MAX_SEARCH_STEPS; i ++ ) {
vec2 pixel = texture( tEdges, texcoord, 0.0 ).rg;
if(!found){
texcoord += vec2( 0.0, 2.0 ) * u_resolution;
e = pixel;
}
if (!found && ! ( texcoord.y > end && e.r > 0.8281 && e.g == 0.0 ) ){
found = true;
}
}
texcoord.y -= 0.25 * u_resolution.y;
texcoord.y -= u_resolution.y;
texcoord.y -= 2.0 * u_resolution.y;
texcoord.y += u_resolution.y * SMAASearchLength(e.gr, 0.0, 0.5 );
return texcoord.y;
}
float SMAASearchYDown(vec2 texcoord, float end ) {
vec2 e = vec2( 1.0, 0.0 );
bool found = false;
for ( int i = 0; i < SMAA_MAX_SEARCH_STEPS; i ++ ) {
vec2 pixel = texture( tEdges, texcoord, 0.0 ).rg;
if(!found){
texcoord -= vec2( 0.0, 2.0 ) * u_resolution;
e = pixel;
}
if (!found && ! ( texcoord.y < end && e.r > 0.8281 && e.g == 0.0 ) ) {
found = true;
}
}
texcoord.y += 0.25 * u_resolution.y;
texcoord.y += u_resolution.y;
texcoord.y += 2.0 * u_resolution.y;
texcoord.y -= u_resolution.y * SMAASearchLength(e.gr, 0.5, 0.5 );
return texcoord.y;
}
vec2 SMAAArea(vec2 dist, float e1, float e2, float offset ) {
vec2 texcoord = float( SMAA_AREATEX_MAX_DISTANCE ) * myRound( 4.0 * vec2( e1, e2 ) ) + dist;
texcoord = SMAA_AREATEX_PIXEL_SIZE * texcoord + ( 0.5 * SMAA_AREATEX_PIXEL_SIZE );
texcoord.y += SMAA_AREATEX_SUBTEX_SIZE * offset;
return texture( tArea, texcoord, 0.0 ).rg;
}
vec4 SMAABlendingWeightCalculationPS( vec2 texcoord, vec2 pixcoord, vec4 offset[ 3 ], ivec4 subsampleIndices ) {
vec4 weights = vec4( 0.0, 0.0, 0.0, 0.0 );
vec2 e = texture( tEdges, texcoord ).rg;
vec2 weightRG = vec2(0.0, 0.0);
vec2 weightBA = vec2(0.0, 0.0);
{
vec2 d;
vec2 coords;
coords.x = SMAASearchXLeft(offset[ 0 ].xy, offset[ 2 ].x );
coords.y = offset[ 1 ].y;
d.x = coords.x;
float e1 = texture( tEdges, coords, 0.0 ).r;
coords.x = SMAASearchXRight( offset[ 0 ].zw, offset[ 2 ].y );
d.y = coords.x;
d = d / u_resolution.x - pixcoord.x;
vec2 sqrt_d = sqrt( abs( d ) );
coords.y -= 1.0 * u_resolution.y;
float e2 = SMAASampleLevelZeroOffset( coords, ivec2( 1, 0 ) ).r;
weightRG = SMAAArea(sqrt_d, e1, e2, float( subsampleIndices.y ) );
}
{
vec2 d;
vec2 coords;
coords.y = SMAASearchYUp(offset[ 1 ].xy, offset[ 2 ].z );
coords.x = offset[ 0 ].x;
d.x = coords.y;
float e1 = texture( tEdges, coords, 0.0 ).g;
coords.y = SMAASearchYDown(offset[ 1 ].zw, offset[ 2 ].w );
d.y = coords.y;
d = d / u_resolution.y - pixcoord.y;
vec2 sqrt_d = sqrt( abs( d ) );
coords.y -= 1.0 * u_resolution.y;
float e2 = SMAASampleLevelZeroOffset( coords, ivec2( 0, 1 ) ).g;
weightBA = SMAAArea(sqrt_d, e1, e2, float( subsampleIndices.x ) );
}
if ( e.g > 0.0 ) {
weights.rg = weightRG;
}
if ( e.r > 0.0 ) {
weights.ba = weightBA;
}
return weights;
}
void main()
{
out_FragColor = SMAABlendingWeightCalculationPS(v_textureCoordinates, fPixCoord, fOffset, ivec4(0.0));
}
