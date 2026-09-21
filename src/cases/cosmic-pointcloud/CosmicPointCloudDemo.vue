<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="pointcloud"
    :camera-distance="28000000"
    :camera-pitch="-15"
    :camera-heading="0"
    :target-height="-6371000"
  />
</template>
