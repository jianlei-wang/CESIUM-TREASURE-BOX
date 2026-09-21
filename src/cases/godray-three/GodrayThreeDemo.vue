<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="godray"
    :camera-distance="2000"
    :camera-pitch="-6"
    :camera-heading="0"
    :target-height="1100"
  />
</template>
