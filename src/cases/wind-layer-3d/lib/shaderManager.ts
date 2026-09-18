import { ShaderSource } from 'cesium'
import { calculateSpeedShader } from './shaders/calculateSpeed'
import { updatePositionShader } from './shaders/updatePosition'
import { postProcessingPositionFragmentShader } from './shaders/postProcessingPosition'
import { renderParticlesFragmentShader, renderParticlesVertexShader } from './shaders/segmentDraw'

export class ShaderManager {
  static getCalculateSpeedShader(): ShaderSource {
    return new ShaderSource({ sources: [calculateSpeedShader] })
  }

  static getUpdatePositionShader(): ShaderSource {
    return new ShaderSource({ sources: [updatePositionShader] })
  }

  static getSegmentDrawVertexShader(): ShaderSource {
    return new ShaderSource({ sources: [renderParticlesVertexShader] })
  }

  static getSegmentDrawFragmentShader(): ShaderSource {
    return new ShaderSource({ sources: [renderParticlesFragmentShader] })
  }

  static getPostProcessingPositionShader(): ShaderSource {
    return new ShaderSource({ sources: [postProcessingPositionFragmentShader] })
  }
}
