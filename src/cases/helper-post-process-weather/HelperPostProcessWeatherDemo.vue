<script setup lang="ts">
import PostProcessDemo from '../post-process-lib/PostProcessDemo.vue'
</script>

<template>
  <PostProcessDemo
    title="天气后期特效"
    hint="雪线、山谷雾、降水、雨圈与闪电五类天气向屏幕特效，可叠加观察暴风雪与雷雨云团的空间层次。"
    :keys="['snowLine', 'valleyFog', 'precipitation', 'rainRings', 'lightning']"
    :initial="['snowLine']"
  />
</template>
