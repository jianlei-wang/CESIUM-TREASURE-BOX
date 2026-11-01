<script setup lang="ts">
import PostProcessDemo from '../post-process-lib/PostProcessDemo.vue'
</script>

<template>
  <PostProcessDemo
    title="风格后期特效"
    hint="手绘地图、色彩隔离、红外、特艺彩色与超 8 胶片。笔触与伪彩共同决定底图观感，颗粒与漏光塑造复古影调。"
    :keys="['dufour', 'colorIsolation', 'infrared', 'technicolor', 'super8']"
    :initial="['dufour']"
  />
</template>
