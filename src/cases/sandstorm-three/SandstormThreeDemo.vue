<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="sandstorm"
    :camera-distance="250"
    :camera-pitch="-12"
    :camera-heading="0"
    :target-height="25"
  />
</template>
