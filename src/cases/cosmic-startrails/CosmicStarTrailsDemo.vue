<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="startrails"
    :camera-distance="191130"
    :camera-pitch="8"
    :camera-heading="180"
    :target-height="26610"
    night-ground
  />
</template>
