<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="nuke"
    :camera-distance="2400"
    :camera-pitch="-16"
    :camera-heading="12"
    :target-height="520"
  />
</template>
