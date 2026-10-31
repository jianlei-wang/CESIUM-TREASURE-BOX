precision highp float;
precision highp int;
in vec4 aPosition;
in vec2 textureCoordinates;
uniform vec2 u_resolution;
out vec2 v_textureCoordinates;
out vec4 fOffset[2];
void SMAANeighborhoodBlendingVS( vec2 texcoord ) {
fOffset[ 0 ] = texcoord.xyxy + u_resolution.xyxy * vec4( -1.0, 0.0, 0.0, 1.0 );
fOffset[ 1 ] = texcoord.xyxy + u_resolution.xyxy * vec4( 1.0, 0.0, 0.0, -1.0 );
}
void main()
{
gl_Position = aPosition;
v_textureCoordinates = textureCoordinates;
SMAANeighborhoodBlendingVS(textureCoordinates);
}
