<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="sonar"
    :camera-distance="1900"
    :camera-pitch="-18"
    :camera-heading="25"
    :target-height="-100"
    :origin-lon="142.2"
    :origin-lat="11.35"
  />
</template>
