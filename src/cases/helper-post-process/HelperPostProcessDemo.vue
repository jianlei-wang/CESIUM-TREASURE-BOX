<script setup lang="ts">
import PostProcessDemo from '../post-process-lib/PostProcessDemo.vue'
import { GROUPS } from '../post-process-lib/effects'
</script>

<template>
  <PostProcessDemo
    title="屏幕后期特效"
    hint="19 种屏幕空间特效按顺序叠加。展开一项可调参数，点击地图可把移轴、聚光与速度线聚焦到该点。"
    :keys="Object.values(GROUPS).flat()"
  />
</template>
