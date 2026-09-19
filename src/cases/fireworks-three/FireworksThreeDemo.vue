<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="fireworks"
    :camera-distance="300"
    :camera-pitch="-24"
    :camera-heading="0"
    :target-height="45"
  />
</template>
