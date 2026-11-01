<script setup lang="ts">
import PostProcessDemo from '../post-process-lib/PostProcessDemo.vue'
</script>

<template>
  <PostProcessDemo
    title="图传画质特效"
    hint="无人机 OSD 叠层、模拟图传噪点干扰与数字图传马赛克，用于模拟无线图传链路的画面劣化。"
    :keys="['droneDisplay', 'analogVideo', 'digitalVideo']"
    :initial="['droneDisplay', 'analogVideo']"
  />
</template>
