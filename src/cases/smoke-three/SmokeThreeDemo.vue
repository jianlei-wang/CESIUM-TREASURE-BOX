<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="smoke"
    :camera-distance="90"
    :camera-pitch="-20"
    :camera-heading="0"
    :target-height="10"
  />
</template>
