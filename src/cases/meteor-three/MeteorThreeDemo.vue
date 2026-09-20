<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="meteor"
    :camera-distance="2000"
    :camera-pitch="10"
    :camera-heading="0"
    :target-height="700"
  />
</template>
