<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="volcano"
    :camera-distance="560"
    :camera-pitch="-14"
    :camera-heading="0"
    :target-height="55"
  />
</template>
