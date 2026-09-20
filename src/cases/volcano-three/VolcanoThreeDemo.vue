<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="volcano"
    :camera-distance="280"
    :camera-pitch="-10"
    :camera-heading="0"
    :target-height="50"
  />
</template>
