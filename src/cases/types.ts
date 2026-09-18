import type { Component } from 'vue'

export type DemoCard = {
  id: string
  title: string
  category: string
  description: string
  tag: string
  icon?: string
  component?: Component
  updatedAt?: string
}

export type CaseCategory = {
  id: string
  label: string
  icon: Component
}
