<script setup lang="ts">
import AnalysisWorkbench from '../terrain-analysis-lib/AnalysisWorkbench.vue'
import { suitabilityProfile } from './profile'
</script>

<template>
  <AnalysisWorkbench :profile="suitabilityProfile" />
</template>
