<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="thunderstorm"
    :camera-distance="340"
    :camera-pitch="-16"
    :camera-heading="0"
    :target-height="45"
  />
</template>
