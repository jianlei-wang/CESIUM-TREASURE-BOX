in vec4 position;
in vec2 textureCoordinates;
out vec2 v_textureCoordinates;
void main() {
    gl_Position = vec4(position.xy, 1.0, 1.0);
    v_textureCoordinates = position.xy*0.5+0.5;
}