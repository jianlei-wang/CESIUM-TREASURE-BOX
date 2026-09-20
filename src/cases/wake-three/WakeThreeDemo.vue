<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="wake"
    :camera-distance="200"
    :camera-pitch="-24"
    :camera-heading="20"
    :target-height="8"
  />
</template>
