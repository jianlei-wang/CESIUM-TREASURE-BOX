<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="snow"
    :camera-distance="260"
    :camera-pitch="-16"
    :camera-heading="0"
    :target-height="60"
  />
</template>
