<script setup lang="ts">
import AnalysisWorkbench from '../terrain-analysis-lib/AnalysisWorkbench.vue'
import { roughnessProfile } from './profile'
</script>

<template>
  <AnalysisWorkbench :profile="roughnessProfile" />
</template>
