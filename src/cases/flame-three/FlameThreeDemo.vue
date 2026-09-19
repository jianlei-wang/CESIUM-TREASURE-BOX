<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="flame"
    :camera-distance="22"
    :camera-pitch="-14"
    :camera-heading="0"
    :target-height="3"
  />
</template>
