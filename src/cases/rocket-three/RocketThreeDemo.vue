<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="rocket"
    :camera-distance="1500"
    :camera-pitch="-8"
    :camera-heading="18"
    :target-height="420"
  />
</template>
