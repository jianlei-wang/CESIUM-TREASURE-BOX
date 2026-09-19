<script setup lang="ts">
import AnalysisWorkbench from '../terrain-analysis-lib/AnalysisWorkbench.vue'
import { triProfile } from './profile'
</script>

<template>
  <AnalysisWorkbench :profile="triProfile" />
</template>
