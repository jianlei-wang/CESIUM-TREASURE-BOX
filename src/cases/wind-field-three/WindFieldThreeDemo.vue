<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="wind-field"
    :camera-distance="34000"
    :camera-pitch="-30"
    :camera-heading="0"
    :target-height="0"
  />
</template>
