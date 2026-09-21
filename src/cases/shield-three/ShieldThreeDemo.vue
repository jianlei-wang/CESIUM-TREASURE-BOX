<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="shield"
    :camera-distance="280"
    :camera-pitch="-12"
    :camera-heading="20"
    :target-height="48"
  />
</template>
