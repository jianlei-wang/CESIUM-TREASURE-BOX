<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="meteor"
    :camera-distance="1500"
    :camera-pitch="6"
    :camera-heading="0"
    :target-height="900"
  />
</template>
