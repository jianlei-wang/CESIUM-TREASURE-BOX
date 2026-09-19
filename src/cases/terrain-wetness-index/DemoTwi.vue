<script setup lang="ts">
import AnalysisWorkbench from '../terrain-analysis-lib/AnalysisWorkbench.vue'
import { twiProfile } from './profile'
</script>

<template>
  <AnalysisWorkbench :profile="twiProfile" />
</template>
