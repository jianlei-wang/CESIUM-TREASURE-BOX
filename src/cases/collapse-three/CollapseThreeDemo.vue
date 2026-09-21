<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="collapse"
    :camera-distance="220"
    :camera-pitch="-14"
    :camera-heading="24"
    :target-height="42"
  />
</template>
