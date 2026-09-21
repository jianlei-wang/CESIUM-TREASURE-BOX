<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="seismic"
    :camera-distance="2600"
    :camera-pitch="-55"
    :camera-heading="0"
    :target-height="0"
  />
</template>
