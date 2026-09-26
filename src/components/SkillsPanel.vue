<script setup lang="ts">
import { computed, ref } from 'vue'
import { Close, MagicStick } from '@element-plus/icons-vue'
import { renderMarkdown, parseFrontmatter } from '../lib/markdown'
import { skills, type Skill, type SkillFile } from '../skills'

const emit = defineEmits<{ (e: 'close'): void }>()

const activeSkillId = ref(skills[0]?.id ?? '')
const activeFileId = ref(skills[0]?.files[0]?.id ?? '')

const activeSkill = computed<Skill | undefined>(() => skills.find((skill) => skill.id === activeSkillId.value))
const activeFile = computed<SkillFile | undefined>(
  () => activeSkill.value?.files.find((file) => file.id === activeFileId.value)
)

const groups = computed(() => {
  const skill = activeSkill.value
  if (!skill) return []
  const order = ['概览', 'references', 'assets']
  const map = new Map<string, SkillFile[]>()
  for (const file of skill.files) {
    if (!map.has(file.group)) map.set(file.group, [])
    map.get(file.group)!.push(file)
  }
  return [...map.entries()].sort((a, b) => {
    const ai = order.indexOf(a[0])
    const bi = order.indexOf(b[0])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0])
  })
})

const previewHtml = computed(() => {
  const file = activeFile.value
  if (!file || !file.markdown) return ''
  return renderMarkdown(parseFrontmatter(file.content).body)
})

function selectSkill(skill: Skill) {
  activeSkillId.value = skill.id
  activeFileId.value = skill.files[0]?.id ?? ''
}

function selectFile(file: SkillFile) {
  activeFileId.value = file.id
}

const groupLabel = (group: string) => (group === '概览' ? 'SKILL.md' : group)
</script>

<template>
  <div class="sk-page">
    <header class="sk-topbar">
      <div class="sk-brand">
        <div class="sk-brand-mark"><el-icon><MagicStick /></el-icon></div>
        <div>
          <p class="sk-brand-name">Cesium酱の百宝箱</p>
          <p class="sk-brand-sub">技能管理 · Skills</p>
        </div>
      </div>
      <button class="sk-back" @click="emit('close')"><el-icon><Close /></el-icon>返回案例库</button>
    </header>

    <div class="sk-body">
      <aside class="sk-side">
        <div class="sk-side-title">技能库 · {{ skills.length }}</div>
        <button
          v-for="skill in skills"
          :key="skill.id"
          class="sk-skill"
          :class="{ active: skill.id === activeSkillId }"
          @click="selectSkill(skill)"
        >
          <span class="sk-skill-name">{{ skill.name }}</span>
          <span class="sk-skill-meta">{{ skill.files.length }} 个文件</span>
        </button>

        <template v-if="activeSkill">
          <div class="sk-side-title files">文件</div>
          <div v-for="[group, items] in groups" :key="group" class="sk-group">
            <p class="sk-group-label">{{ groupLabel(group) }}</p>
            <button
              v-for="file in items"
              :key="file.id"
              class="sk-file"
              :class="{ active: file.id === activeFileId }"
              @click="selectFile(file)"
            >
              {{ file.name }}
            </button>
          </div>
        </template>
      </aside>

      <main class="sk-content">
        <template v-if="activeSkill && activeFile">
          <div class="sk-hero">
            <p class="sk-eyebrow">SKILL / {{ activeSkill.id }}</p>
            <h1>{{ activeSkill.name }}</h1>
            <p class="sk-desc">{{ activeSkill.description }}</p>
            <div class="sk-meta">
              <span><b>文件：</b>{{ activeFile.id }}</span>
              <span><b>类型：</b>{{ activeFile.language }}</span>
              <span><b>总文件数：</b>{{ activeSkill.files.length }}</span>
            </div>
          </div>

          <div class="sk-doc">
            <div class="sk-doc-bar">
              <span class="sk-doc-path">{{ activeFile.id }}</span>
            </div>
            <div v-if="activeFile.markdown" class="sk-markdown" v-html="previewHtml"></div>
            <pre v-else class="sk-code"><code>{{ activeFile.content }}</code></pre>
          </div>
        </template>
        <div v-else class="sk-empty">暂无可用技能</div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.sk-page { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; background: linear-gradient(160deg, #0b1a33 0%, #0e2038 55%, #122a4a 100%); color: #dce8f5; }
.sk-topbar { display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 20px; background: rgba(8, 21, 40, 0.92); border-bottom: 1px solid rgba(157, 188, 224, 0.18); backdrop-filter: blur(8px); }
.sk-brand { display: flex; align-items: center; gap: 10px; }
.sk-brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #7b5cff, #38b6ff); color: #fff; font-size: 16px; }
.sk-brand-name { font-size: 13px; font-weight: 700; line-height: 1.2; }
.sk-brand-sub { font-size: 10px; color: #7f96b3; line-height: 1.2; }
.sk-back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 7px; background: rgba(47, 128, 237, 0.14); color: #dce8f5; font-size: 12px; cursor: pointer; transition: background 0.2s; }
.sk-back:hover { background: rgba(47, 128, 237, 0.3); }
.sk-body { flex: 1; min-height: 0; display: flex; gap: 18px; padding: 20px; }
.sk-side { flex: 0 0 244px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; padding: 12px; border-radius: 12px; background: rgba(13, 32, 62, 0.78); border: 1px solid rgba(157, 188, 224, 0.18); }
.sk-side::-webkit-scrollbar { width: 8px; }
.sk-side::-webkit-scrollbar-thumb { background: rgba(157, 188, 224, 0.25); border-radius: 4px; }
.sk-side-title { margin: 2px 4px 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: #7f96b3; }
.sk-side-title.files { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(157, 188, 224, 0.14); }
.sk-skill { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border-radius: 9px; background: transparent; color: #c3d5e8; text-align: left; cursor: pointer; transition: background 0.15s; }
.sk-skill:hover { background: rgba(47, 128, 237, 0.18); }
.sk-skill.active { background: rgba(47, 128, 237, 0.3); color: #fff; }
.sk-skill-name { font-size: 12.5px; font-weight: 700; }
.sk-skill-meta { font-size: 10px; color: #8ea6c4; }
.sk-group { margin-bottom: 6px; }
.sk-group-label { margin: 8px 4px 4px; font-size: 10px; letter-spacing: 0.08em; color: #6f88a8; text-transform: uppercase; }
.sk-file { display: block; width: 100%; padding: 6px 12px; border-radius: 7px; background: transparent; color: #b7c9de; font-size: 12px; text-align: left; cursor: pointer; transition: background 0.15s; }
.sk-file:hover { background: rgba(47, 128, 237, 0.18); color: #dce8f5; }
.sk-file.active { background: rgba(101, 211, 235, 0.18); color: #65d3eb; }
.sk-content { flex: 1; min-width: 0; overflow-y: auto; padding-right: 6px; }
.sk-content::-webkit-scrollbar { width: 8px; }
.sk-content::-webkit-scrollbar-thumb { background: rgba(157, 188, 224, 0.25); border-radius: 4px; }
.sk-hero { padding: 26px 30px; border-radius: 16px; background: linear-gradient(135deg, rgba(123, 92, 255, 0.2), rgba(20, 42, 82, 0.4)); border: 1px solid rgba(157, 188, 224, 0.22); }
.sk-eyebrow { font-size: 10px; letter-spacing: 0.18em; color: #65d3eb; font-weight: 700; text-transform: uppercase; }
.sk-hero h1 { margin: 6px 0 8px; font-size: 24px; font-weight: 800; letter-spacing: -0.3px; }
.sk-desc { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; font-size: 12px; line-height: 1.7; color: #9fb3cd; }
.sk-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; }
.sk-meta span { padding: 3px 12px; border-radius: 20px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(157, 188, 224, 0.16); font-size: 11px; color: #b8c9de; }
.sk-meta b { color: #65d3eb; }
.sk-doc { margin-top: 18px; border-radius: 14px; background: rgba(13, 32, 62, 0.78); border: 1px solid rgba(157, 188, 224, 0.18); overflow: hidden; }
.sk-doc-bar { padding: 10px 18px; border-bottom: 1px solid rgba(157, 188, 224, 0.14); background: rgba(8, 21, 40, 0.5); }
.sk-doc-path { font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; font-size: 11px; color: #8ea6c4; }
.sk-markdown { padding: 22px 28px; color: #b8c9de; font-size: 13.5px; line-height: 1.8; }
.sk-markdown :deep(h1) { margin: 0 0 14px; padding-bottom: 10px; border-bottom: 2px solid rgba(47, 128, 237, 0.6); font-size: 22px; color: #f0f6ff; }
.sk-markdown :deep(h2) { margin: 26px 0 12px; padding-left: 10px; border-left: 4px solid #2f80ed; font-size: 17px; color: #f0f6ff; }
.sk-markdown :deep(h3) { margin: 20px 0 10px; font-size: 14.5px; color: #dce8f5; }
.sk-markdown :deep(h4) { margin: 16px 0 8px; font-size: 13px; color: #c3d5e8; }
.sk-markdown :deep(p) { margin: 8px 0; }
.sk-markdown :deep(ul), .sk-markdown :deep(ol) { margin: 8px 0; padding-left: 22px; }
.sk-markdown :deep(li) { margin: 4px 0; }
.sk-markdown :deep(strong) { color: #f0f6ff; }
.sk-markdown :deep(a) { color: #65d3eb; text-decoration: none; }
.sk-markdown :deep(a:hover) { text-decoration: underline; }
.sk-markdown :deep(code) { padding: 1px 6px; border-radius: 4px; background: rgba(101, 211, 235, 0.12); color: #7fdcf0; font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; font-size: 12px; }
.sk-markdown :deep(.md-code) { position: relative; margin: 12px 0; padding: 16px 18px; border-radius: 10px; background: #0d1830; border: 1px solid rgba(157, 188, 224, 0.16); overflow-x: auto; }
.sk-markdown :deep(.md-code code) { padding: 0; background: transparent; color: #cfe0f2; font-size: 12px; line-height: 1.7; white-space: pre; }
.sk-markdown :deep(.md-code-lang) { position: absolute; top: 8px; right: 14px; font-size: 10px; color: rgba(220, 232, 245, 0.35); }
.sk-markdown :deep(blockquote) { margin: 12px 0; padding: 10px 16px; border-left: 4px solid #7b5cff; border-radius: 6px; background: rgba(123, 92, 255, 0.1); color: #a9bcd6; }
.sk-markdown :deep(hr) { margin: 20px 0; border: 0; border-top: 1px dashed rgba(157, 188, 224, 0.2); }
.sk-markdown :deep(.md-table-wrap) { margin: 12px 0; overflow-x: auto; border-radius: 10px; border: 1px solid rgba(157, 188, 224, 0.18); }
.sk-markdown :deep(table) { width: 100%; border-collapse: collapse; font-size: 12px; }
.sk-markdown :deep(th), .sk-markdown :deep(td) { padding: 9px 14px; text-align: left; border-bottom: 1px solid rgba(157, 188, 224, 0.12); }
.sk-markdown :deep(th) { background: rgba(47, 128, 237, 0.16); color: #dce8f5; font-weight: 700; }
.sk-markdown :deep(tr:last-child td) { border-bottom: 0; }
.sk-code { margin: 0; padding: 20px 24px; font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; font-size: 12px; line-height: 1.7; color: #cfe0f2; white-space: pre-wrap; word-break: break-word; }
.sk-empty { display: grid; place-items: center; height: 100%; color: #7f96b3; font-size: 13px; }
@media (max-width: 860px) {
  .sk-body { flex-direction: column; }
  .sk-side { flex: none; max-height: 220px; }
}
</style>
