<script setup lang="ts">
import QuarksEffectDemo from '../quarks-effects-lib/QuarksEffectDemo.vue'
</script>

<template>
  <QuarksEffectDemo
    effect="blackhole"
    :camera-distance="34000000"
    :camera-pitch="-10"
    :camera-heading="25"
    :target-height="-6371000"
  />
</template>
