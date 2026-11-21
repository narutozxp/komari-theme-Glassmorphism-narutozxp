<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { AppDialog } from '@/components/ui/app-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { useThreeNetPingSettings } from '@/composables/useThreeNetPingSettings'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const {
  loading,
  saving,
  error,
  catalogError,
  nodeSearch,
  taskSearch,
  activeNodeId,
  bindings,
  dirty,
  pingDisplayMode,
  sparklineEnabled,
  visibleNodes,
  filteredNodes,
  isGlobal,
  usesGlobal,
  activeNodeName,
  activeTaskIds,
  availableTasks,
  unavailableTaskIds,
  filteredTasks,
  configuredNodeCount,
  hasPreviewSelection,
  previewTasks,
  selectedTaskOrder,
  canSelectAll,
  globalChanged,
  taskName,
  toggleTask,
  selectAllTasks,
  clearTasks,
  restoreDefaultTasks,
  showNodeSettings,
  save,
} = useThreeNetPingSettings()
const pingDisplayOptions = [
  { value: 'carrier', label: '三网平均' },
  { value: 'summary', label: '所选任务平均' },
  { value: 'full', label: '逐条显示（任务全称）' },
]
const pingDisplayHelp = {
  carrier: '将本机所选任务按电信、联通、移动分组，每组分别汇总。其他任务可在另外两种方式中查看。',
  summary: '把本机所选任务合并成一行，显示平均延迟和丢包率。',
  full: '每条所选任务单独显示，保留后台的任务全称。',
}
</script>

<template>
  <AppDialog
    :open="open"
    title="首页 Ping 显示设置"
    description="选择首页节点卡片显示的任务。探测目标、间隔和服务器分配在 Komari 后台管理。"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-4">
      <div v-if="error" role="alert" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {{ error }}
      </div>

      <section class="glass-control-surface grid gap-3 rounded-xl p-3 sm:grid-cols-[1fr_auto] sm:items-start sm:p-4" aria-labelledby="ping-display-title">
        <div class="min-w-0 space-y-3">
          <h3 id="ping-display-title" class="flex items-center gap-2 text-sm font-semibold">
            <Icon icon="tabler:chart-line" width="17" height="17" class="text-primary" aria-hidden="true" />全局显示方式
          </h3>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label class="flex min-w-0 flex-col gap-1 text-xs font-medium sm:flex-row sm:items-center sm:gap-2">
              <span>探测显示方式</span>
              <select
                v-model="pingDisplayMode"
                :disabled="loading || saving"
                class="h-9 min-w-0 max-w-full rounded-md border border-input bg-popover px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <option v-for="option in pingDisplayOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="flex min-h-8 items-center gap-2 text-sm">
              <input v-model="sparklineEnabled" type="checkbox" :disabled="loading || saving" class="size-4 accent-primary">
              曲线样式
            </label>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">
            {{ pingDisplayHelp[pingDisplayMode] }}
          </p>
        </div>
        <a href="/admin/ping" target="_blank" rel="noopener noreferrer" class="inline-flex w-fit items-center gap-1.5 rounded-sm text-xs font-medium text-primary hover:underline">
          后台探测任务<Icon icon="tabler:external-link" width="14" height="14" aria-hidden="true" />
        </a>
      </section>

      <div class="glass-control-surface grid grid-cols-2 gap-1 rounded-lg p-1 sm:w-fit" role="group" aria-label="Ping 配置范围">
        <Button type="button" variant="ghost" size="sm" class="glass-control-button h-9 gap-2 px-3" :aria-pressed="isGlobal" :disabled="saving" @click="activeNodeId = 'global'">
          <Icon icon="tabler:world" width="16" height="16" aria-hidden="true" />全局任务
        </Button>
        <Button type="button" variant="ghost" size="sm" class="glass-control-button h-9 gap-2 px-3" :aria-pressed="!isGlobal" :disabled="saving || !visibleNodes.length" @click="showNodeSettings">
          <Icon icon="tabler:server" width="16" height="16" aria-hidden="true" />按服务器
        </Button>
      </div>

      <div class="grid min-w-0 gap-4" :class="!isGlobal && 'md:grid-cols-[minmax(12.5rem,0.8fr)_minmax(0,2fr)]'">
        <label v-if="!isGlobal" class="grid min-w-0 gap-1.5 text-sm font-medium md:hidden">
          <span>选择服务器</span>
          <select v-model="activeNodeId" :disabled="saving" class="h-9 w-full min-w-0 truncate rounded-md border border-input bg-popover px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring">
            <option v-for="node in visibleNodes" :key="node.uuid" :value="node.uuid">{{ node.name }}</option>
          </select>
        </label>

        <aside v-if="!isGlobal" class="hidden min-w-0 self-start flex-col gap-2 rounded-xl border border-border/70 p-2 md:flex" aria-label="服务器列表">
          <div class="flex items-center justify-between gap-2 px-2 pt-1 text-xs font-medium text-muted-foreground">
            <span>服务器</span>
            <span>{{ configuredNodeCount }} 台自定义</span>
          </div>
          <Input v-model="nodeSearch" aria-label="搜索服务器" class="h-8 text-xs" placeholder="搜索服务器" />
          <div v-if="filteredNodes.length" class="max-h-[min(34dvh,18rem)] space-y-1 overflow-y-auto pe-1">
            <button
              v-for="node in filteredNodes" :key="node.uuid"
              type="button" :aria-pressed="activeNodeId === node.uuid" :disabled="saving"
              class="glass-control-button flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-accent/60"
              @click="activeNodeId = node.uuid"
            >
              <span class="size-1.5 shrink-0 rounded-full" :class="node.online ? 'bg-success' : 'bg-muted-foreground/40'" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="node.name">{{ node.name }}</span>
              <span v-if="bindings[node.uuid]?.length" class="shrink-0 text-[10px] text-muted-foreground">自定义</span>
            </button>
          </div>
          <Empty v-else description="暂无匹配服务器" class="py-5" />
        </aside>

        <section v-if="activeNodeName" class="min-w-0 space-y-3 rounded-xl border border-border/70 p-3 sm:p-4" aria-labelledby="ping-task-scope-title">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 id="ping-task-scope-title" class="break-words text-sm font-semibold">
                {{ activeNodeName }}
              </h3>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                {{ isGlobal ? '未自定义的服务器使用这里的选择。各服务器只展示分配给自己的任务。'
                  : usesGlobal ? '当前沿用全局默认。勾选下方任务可为这台服务器单独设置。'
                    : '这台服务器优先使用自定义任务。清空后沿用全局默认。' }}
              </p>
            </div>
            <Badge v-if="!isGlobal" :variant="usesGlobal ? 'outline' : 'secondary'">
              {{ usesGlobal ? '沿用全局' : '单台自定义' }}
            </Badge>
          </div>

          <div class="rounded-lg bg-secondary/60 px-3 py-2 text-xs" aria-live="polite">
            <span class="font-medium">首页显示预览</span>
            <div v-if="previewTasks.length" class="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              <span v-for="task in previewTasks" :key="task.id" class="break-all rounded-md border border-border/80 bg-popover/70 px-2 py-1 text-foreground" :title="task.name">
                {{ task.label }}<span v-if="typeof task.id === 'string'" class="ml-1 text-muted-foreground">{{ task.taskIds.length }} 条</span>
              </span>
            </div>
            <p v-else class="mt-1 text-muted-foreground">
              {{ loading ? '正在读取任务'
                : catalogError ? '任务目录暂不可用'
                  : !hasPreviewSelection ? '未配置任务时显示本机默认平均'
                    : pingDisplayMode === 'carrier' ? '所选任务暂无可展示的三网线路'
                      : '所选任务暂无可展示的线路' }}
            </p>
          </div>

          <div class="grid min-w-0 gap-2 lg:flex lg:items-center">
            <Input v-model="taskSearch" aria-label="搜索 Ping 任务" class="h-8 min-w-0 lg:flex-1 text-xs" placeholder="搜索 Ping 任务名称或 ID" />
            <div class="flex flex-wrap items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" :disabled="loading || saving || !canSelectAll" @click="selectAllTasks">
                选中全部可用
              </Button>
              <Button v-if="isGlobal" type="button" variant="ghost" size="sm" :disabled="loading || saving || !activeTaskIds.length" @click="clearTasks">
                清空选择
              </Button>
              <Button
                type="button" variant="ghost" size="sm" class="gap-1.5"
                :title="isGlobal ? '撤销这次未保存的全局任务改动' : '清除这台服务器的自定义选择'"
                :disabled="loading || saving || (isGlobal ? !globalChanged : !activeTaskIds.length)"
                @click="restoreDefaultTasks"
              >
                <Icon icon="tabler:restore" width="14" height="14" aria-hidden="true" />
                {{ isGlobal ? '恢复默认任务' : '恢复全局默认' }}
              </Button>
            </div>
          </div>

          <div v-if="catalogError" role="alert" class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground">
            {{ catalogError }}
          </div>
          <div v-if="!loading && unavailableTaskIds.length" class="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p class="text-sm font-medium">
              {{ catalogError ? '暂时无法核对以下已选任务' : '以下已选任务当前不可用' }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              {{ catalogError ? '原有选择仍保留，可以移除后保存。' : '任务可能已删除，或已从这台服务器取消分配。' }}
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button v-for="id in unavailableTaskIds" :key="id" type="button" variant="outline" size="sm" :title="taskName(id)" :disabled="saving" :aria-label="`移除任务 ID ${id}`" @click="toggleTask(id)">
                {{ taskName(id) }}<Icon icon="tabler:x" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>已选 {{ activeTaskIds.length }} 个</span>
            <span>{{ availableTasks.length }} 个可用 · 按勾选顺序显示</span>
          </div>
          <div v-if="loading" role="status" class="py-6 text-center text-sm text-muted-foreground">
            正在加载 Ping 任务…
          </div>
          <div v-else-if="filteredTasks.length" class="grid gap-2 sm:grid-cols-2 md:max-h-[min(30dvh,18rem)] md:overflow-y-auto md:p-0.5">
            <label
              v-for="task in filteredTasks" :key="task.id"
              class="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-ring"
              :class="selectedTaskOrder.has(task.id) ? 'border-primary/50 bg-primary/10' : 'border-border/70 hover:bg-accent/60'"
            >
              <input type="checkbox" class="size-4 shrink-0 accent-primary" :aria-label="task.name" :checked="selectedTaskOrder.has(task.id)" :disabled="saving" @change="toggleTask(task.id)">
              <span class="min-w-0 flex-1">
                <span class="block break-words text-sm font-medium">{{ task.name }}</span>
                <span class="block text-[11px] text-muted-foreground">{{ task.type ? `${task.type.toUpperCase()} · ` : '' }}ID {{ task.id }}</span>
              </span>
              <span v-if="selectedTaskOrder.has(task.id)" aria-hidden="true" class="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-medium text-selection">{{ selectedTaskOrder.get(task.id) }}</span>
            </label>
          </div>
          <Empty
            v-else
            :description="catalogError ? '暂时无法取得任务列表' : taskSearch.trim() ? '暂无匹配 Ping 任务' : isGlobal ? '后台暂无 Ping 任务' : '暂无分配给这台服务器的任务'"
            class="py-6"
          />
        </section>
        <Empty v-else description="请选择服务器" />
      </div>
    </div>
    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground" aria-live="polite">
          {{ dirty ? '有未保存的修改' : '与后台主题设置同步' }}
        </span>
        <Button type="button" class="ml-auto" :disabled="!dirty || saving" @click="save">
          <Icon icon="tabler:device-floppy" aria-hidden="true" />{{ saving ? '保存中' : dirty ? '保存配置' : '配置已保存' }}
        </Button>
      </div>
    </template>
  </AppDialog>
</template>
