<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="solar-wind"
    :camera-distance="28000000"
    :camera-pitch="-18"
    :camera-heading="270"
    :target-height="-6371000"
  />
</template>
