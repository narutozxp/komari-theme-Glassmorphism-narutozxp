<script setup lang="ts">
import type { NodeData } from '@/stores/nodes'
import { Icon } from '@iconify/vue'
import { computed, ref, useId, watch } from 'vue'
import mapPaths from '@/assets/world-map-paths.json'
import { useNodeGeoClusters } from '@/composables/useNodeGeoClusters'
import { useAppStore } from '@/stores/app'
import { getCoordByCode } from '@/utils/geoHelper'
import { getRegionDisplayName } from '@/utils/regionHelper'

interface RegionMarker {
  code: string
  label: string
  position: string
  servers: number
  onlineServers: number
}

const props = defineProps<{ nodes?: NodeData[] }>()
const appStore = useAppStore()
const { regionClusters, totalServers, onlineServers } = useNodeGeoClusters({ nodes: () => props.nodes })
const hoveredCode = ref('')
const focusedCode = ref('')
const selectedCode = ref('')
const headingId = useId()
const glowId = useId()
const regionBorderFallback: Readonly<Record<string, string>> = { HK: 'CN', MO: 'CN' }
const regionCodePattern = /^[A-Z]{2}$/
const mapWidth = 1000
const mapHeight = 360
const mapPathTransform = `scale(1 ${mapHeight / 500})`

// Use the same bounds as the map paths, scaled to the shorter viewBox.
function project([latitude, longitude]: [number, number]): string {
  const x = (longitude + 180) / 360 * mapWidth
  const y = (84 - Math.min(84, Math.max(-60, latitude))) / 144 * mapHeight
  return `translate(${x} ${y})`
}

const markers = computed(() => {
  const regions = new Map<string, RegionMarker>()
  for (const cluster of regionClusters.value) {
    const code = cluster.code.toUpperCase()
    if (!regionCodePattern.test(code))
      continue

    const existing = regions.get(code)
    if (existing) {
      existing.servers += cluster.servers
      existing.onlineServers += cluster.onlineServers
      continue
    }

    regions.set(code, {
      code,
      label: getRegionDisplayName(code) || code,
      position: project(getCoordByCode(code) ?? cluster.coord),
      servers: cluster.servers,
      onlineServers: cluster.onlineServers,
    })
  }
  return Array.from(regions.values())
})

const activeMarker = computed(() => {
  const code = hoveredCode.value || focusedCode.value || selectedCode.value
  return markers.value.find(marker => marker.code === code)
})

const highlightedRegion = computed(() => {
  const code = activeMarker.value?.code ?? ''
  return regionBorderFallback[code] ?? code
})

watch(markers, (regions) => {
  for (const code of [hoveredCode, focusedCode, selectedCode]) {
    if (code.value && !regions.some(region => region.code === code.value))
      code.value = ''
  }
})

function toggleMarker(code: string) {
  selectedCode.value = selectedCode.value === code ? '' : code
}

function clearMarker() {
  hoveredCode.value = ''
  focusedCode.value = ''
  selectedCode.value = ''
}
</script>

<template>
  <section class="star-map" :class="{ 'star-map--still': appStore.stopEarth || appStore.disablePageAnimation }" :aria-labelledby="headingId">
    <div class="star-map__heading">
      <h2 :id="headingId">
        <Icon icon="tabler:world" width="18" height="18" aria-hidden="true" />
        节点地图
      </h2>
      <span>{{ markers.length }} 个地区 · {{ onlineServers }} / {{ totalServers }} 个节点在线</span>
    </div>

    <svg
      class="star-map__svg"
      :viewBox="`0 0 ${mapWidth} ${mapHeight}`"
      role="group"
      aria-label="节点地区分布"
    >
      <defs>
        <filter :id="glowId" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <g class="star-map__grid" :transform="mapPathTransform" aria-hidden="true">
        <path v-for="x in [125, 250, 375, 500, 625, 750, 875]" :key="`x-${x}`" :d="`M${x},15 V485`" />
        <path v-for="y in [100, 200, 300, 400]" :key="`y-${y}`" :d="`M20,${y} H980`" />
      </g>

      <g class="star-map__regions" :transform="mapPathTransform" aria-hidden="true">
        <path
          v-for="(region, index) in mapPaths"
          :key="index"
          :d="region.path"
          :data-map-region-code="region.code || undefined"
          :class="{ 'is-active': region.code && region.code === highlightedRegion }"
          :filter="region.code && region.code === highlightedRegion ? `url(#${glowId})` : undefined"
        />
      </g>

      <g
        v-for="marker in markers"
        :key="marker.code"
        class="star-map__marker"
        :class="{ 'is-active': marker.code === activeMarker?.code, 'is-offline': marker.onlineServers === 0 }"
        :transform="marker.position"
        :data-map-marker-code="marker.code"
        role="button"
        tabindex="0"
        :aria-pressed="marker.code === selectedCode"
        :aria-label="`${marker.label}，${marker.onlineServers} / ${marker.servers} 个节点在线`"
        @pointerenter="$event.pointerType === 'mouse' && (hoveredCode = marker.code)"
        @pointerleave="hoveredCode = ''"
        @focus="focusedCode = marker.code"
        @blur="focusedCode = ''"
        @click="toggleMarker(marker.code)"
        @keydown.enter.prevent="toggleMarker(marker.code)"
        @keydown.space.prevent="toggleMarker(marker.code)"
        @keydown.esc.stop.prevent="clearMarker"
      >
        <circle r="17" fill="transparent" aria-hidden="true" />
        <circle class="star-map__pulse" r="12" aria-hidden="true" />
        <circle class="star-map__halo" r="8.5" aria-hidden="true" />
        <circle class="star-map__dot" r="5.2" aria-hidden="true" />
      </g>
    </svg>

    <div class="star-map__status" aria-live="polite">
      <template v-if="activeMarker">
        <strong>{{ activeMarker.label }}</strong>
        <span :class="{ 'is-offline': activeMarker.onlineServers === 0 }">
          {{ activeMarker.onlineServers }} / {{ activeMarker.servers }} 个节点在线
        </span>
      </template>
      <span v-else>{{ markers.length ? '选择地图标记查看地区状态' : '暂无可定位节点' }}</span>
    </div>
  </section>
</template>

<style scoped>
.star-map {
  --map-label: #4f2b89;
  --map-muted: #594868;
  --map-grid: rgb(109 53 199 / 0.15);
  --map-fill: rgb(124 58 237 / 0.11);
  --map-coast: rgb(79 70 229 / 0.52);
  --map-active: #167648;
  --map-active-fill: rgb(34 197 94 / 0.32);
  --map-online: #a65405;
  --map-online-core: #ffe298;
  --map-offline: #b42346;
  --map-offline-core: #ffd6df;
  position: relative;
  isolation: isolate;
  display: grid;
  min-width: 0;
  height: clamp(13rem, 58vw, 16.5rem);
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid rgb(109 53 199 / 0.22);
  border-radius: 1rem;
  background:
    radial-gradient(ellipse at 76% 37%, rgb(167 139 250 / 0.26), transparent 55%),
    radial-gradient(ellipse at 18% 76%, rgb(34 211 238 / 0.2), transparent 52%),
    linear-gradient(135deg, #fcfaff, #eee8fb 55%, #e8f6fe);
  box-shadow:
    inset 0 1px rgb(255 255 255 / 0.7),
    0 8px 24px rgb(80 43 137 / 0.1);
}

.dark .star-map {
  --map-label: #b5efff;
  --map-muted: #c8bddc;
  --map-grid: rgb(96 165 250 / 0.15);
  --map-fill: rgb(123 112 255 / 0.17);
  --map-coast: rgb(153 198 255 / 0.54);
  --map-active: #86efac;
  --map-active-fill: rgb(34 197 94 / 0.34);
  --map-online: #fbbf45;
  --map-online-core: #fff0b5;
  --map-offline: #fb7185;
  --map-offline-core: #ffe4e9;
  border-color: rgb(155 92 255 / 0.31);
  background:
    radial-gradient(ellipse at 75% 44%, rgb(139 92 246 / 0.25), transparent 56%),
    radial-gradient(ellipse at 22% 70%, rgb(14 165 233 / 0.16), transparent 54%),
    linear-gradient(135deg, #050817, #0b0b23 54%, #050817);
  box-shadow:
    inset 0 1px rgb(255 255 255 / 0.06),
    0 14px 36px rgb(0 0 0 / 0.25);
}

.color-vision-friendly .star-map {
  --map-active: var(--success);
  --map-active-fill: color-mix(in srgb, var(--success) 38%, transparent);
  --map-online: var(--success);
  --map-offline: var(--destructive);
}

.star-map::before {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0 4px, var(--map-grid) 5px);
  opacity: 0.3;
  pointer-events: none;
  content: '';
}

.star-map__heading,
.star-map__status {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.65rem;
  padding: 0.6rem 1rem;
  color: var(--map-muted);
  font-size: 0.8125rem;
}

.star-map__heading {
  justify-content: space-between;
}

.star-map__heading h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  color: var(--map-label);
  font-size: 1rem;
  font-weight: 700;
}

.star-map__status {
  justify-content: flex-end;
  min-height: 2.5rem;
}

.star-map__status strong {
  color: var(--map-label);
}

.star-map__status .is-offline {
  color: var(--map-offline);
}

.star-map__svg {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding-inline: 0.4rem;
}

.star-map__grid path {
  fill: none;
  stroke: var(--map-grid);
  stroke-dasharray: 2 8;
}

.star-map__regions path {
  fill: var(--map-fill);
  fill-rule: evenodd;
  stroke: var(--map-coast);
  stroke-linejoin: round;
  stroke-width: 0.9;
}

.star-map__regions .is-active {
  fill: var(--map-active-fill);
  stroke: var(--map-active);
  stroke-width: 2.2;
}

.star-map__marker {
  --marker-edge: var(--map-online);
  --marker-core: var(--map-online-core);
  cursor: pointer;
  outline: none;
}

.star-map__marker.is-offline {
  --marker-edge: var(--map-offline);
  --marker-core: var(--map-offline-core);
}

.star-map__pulse,
.star-map__dot {
  stroke: var(--marker-edge);
  stroke-width: 1.8;
}

.star-map__pulse {
  fill: none;
  transform-box: fill-box;
  transform-origin: center;
  animation: map-signal 2.2s ease-out infinite;
}

.star-map__halo {
  fill: var(--marker-edge);
  opacity: 0.25;
}

.star-map__marker.is-active .star-map__halo,
.star-map__marker:focus-visible .star-map__halo {
  fill: none;
  opacity: 1;
  stroke: var(--map-label);
  stroke-width: 2;
}

.star-map__dot {
  fill: var(--marker-core);
}

.star-map--still .star-map__pulse {
  animation: none;
  opacity: 0.55;
}

@keyframes map-signal {
  0% {
    opacity: 0.95;
    transform: scale(0.65);
  }

  75%,
  100% {
    opacity: 0;
    transform: scale(1.7);
  }
}

@media (max-width: 639px) {
  .star-map__heading,
  .star-map__status {
    padding-inline: 0.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .star-map__pulse {
    animation: none;
    opacity: 0.55;
  }
}
</style>
