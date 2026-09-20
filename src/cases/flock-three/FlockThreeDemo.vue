<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="flock"
    :camera-distance="1700"
    :camera-pitch="-10"
    :camera-heading="0"
    :target-height="240"
  />
</template>
