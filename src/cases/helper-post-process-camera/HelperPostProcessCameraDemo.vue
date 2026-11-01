<script setup lang="ts">
import PostProcessDemo from '../post-process-lib/PostProcessDemo.vue'
</script>

<template>
  <PostProcessDemo
    title="镜头后期特效"
    hint="聚光、移轴、运动模糊、速度线、广角畸变与果冻效应。点击地图可把焦点锁定到该点，用于航拍与运动镜头。"
    :keys="['spotlight', 'tiltShift', 'motionBlur', 'speedLines', 'lensDistortion', 'jello']"
    :initial="['tiltShift']"
  />
</template>
