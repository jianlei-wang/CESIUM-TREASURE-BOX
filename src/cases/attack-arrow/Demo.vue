<script setup lang="ts">
import PlottingCaseShell from '../military-plotting-lib/PlottingCaseShell.vue'
import type { PlottingKind } from '../military-plotting-lib'
</script>

<template>
  <PlottingCaseShell :kind="'attack-arrow' as PlottingKind" />
</template>
