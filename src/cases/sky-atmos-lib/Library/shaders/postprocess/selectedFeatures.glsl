#define CZM_SELECTED_FEATURE 
uniform sampler2D czm_idTexture; 
uniform sampler2D czm_selectedIdTexture; 
uniform float czm_selectedIdTextureStep; 
in vec2 v_textureCoordinates; 
bool czm_selected(vec2 offset) 
{ 
    bool selected = false;
    vec4 id = texture(czm_idTexture, v_textureCoordinates + offset); 
    for (int i = 0; i < __SELECTED_ID_TEXTURE_WIDTH__; ++i) 
    { 
        vec4 selectedId = texture(czm_selectedIdTexture, vec2((float(i) + 0.5) * czm_selectedIdTextureStep, 0.5)); 
        if (all(equal(id, selectedId))) 
        { 
            return true; 
        } 
    } 
    return false; 
} 

bool czm_selected() 
{ 
    return czm_selected(vec2(0.0)); 
} 

