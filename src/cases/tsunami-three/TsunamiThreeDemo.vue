<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="tsunami"
    :camera-distance="620"
    :camera-pitch="-24"
    :camera-heading="0"
    :target-height="60"
  />
</template>
