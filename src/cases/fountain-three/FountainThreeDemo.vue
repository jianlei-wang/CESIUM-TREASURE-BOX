<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="fountain"
    :camera-distance="70"
    :camera-pitch="-18"
    :camera-heading="0"
    :target-height="6"
  />
</template>
