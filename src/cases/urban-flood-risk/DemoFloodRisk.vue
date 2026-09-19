<script setup lang="ts">
import AnalysisWorkbench from '../terrain-analysis-lib/AnalysisWorkbench.vue'
import { floodRiskProfile } from './profile'
</script>

<template>
  <AnalysisWorkbench :profile="floodRiskProfile" />
</template>
