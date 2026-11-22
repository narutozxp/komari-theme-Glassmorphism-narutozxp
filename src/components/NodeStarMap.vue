<script setup lang="ts">
import type { RegionCluster } from '@/composables/useNodeGeoClusters'
import type { NodeData } from '@/stores/nodes'
import type { RegionalBoundary } from '@/utils/regionalMap'
import { Icon } from '@iconify/vue'
import { useElementSize } from '@vueuse/core'
import { PopoverClose, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import mapPaths from '@/assets/world-map-paths.json'
import { useNodeGeoClusters } from '@/composables/useNodeGeoClusters'
import { useAppStore } from '@/stores/app'
import { getCoordByCode } from '@/utils/geoHelper'
import { findRegionalBoundary, fitRegionalMap, hasRegionalBoundaries, loadRegionalBoundaries, regionalPoint } from '@/utils/regionalMap'
import { getRegionDisplayName } from '@/utils/regionHelper'

type RegionMarker = Pick<RegionCluster, 'id' | 'code' | 'label' | 'coord' | 'servers' | 'onlineServers'> & { subdivisions?: RegionMarker[] }

interface CountryMarker extends RegionMarker {
  subdivisions: RegionMarker[]
}

const props = defineProps<{ nodes?: NodeData[] }>()
const appStore = useAppStore()
const { regionClusters, totalServers, onlineServers } = useNodeGeoClusters({ nodes: () => props.nodes, groupBy: 'province' })
const hoveredId = ref('')
const focusedId = ref('')
const selectedId = ref('')
const countryCode = ref('')
const detailsOpen = ref(false)
const detailsTrigger = ref<HTMLButtonElement | null>(null)
const mapCanvas = ref<HTMLDivElement | null>(null)
const { width: canvasWidth, height: canvasHeight } = useElementSize(mapCanvas)
const boundaries = shallowRef<RegionalBoundary[]>([])
const headingId = useId()
const glowId = useId()
const regionBorderFallback: Readonly<Record<string, string>> = { HK: 'CN', MO: 'CN' }
const regionCodePattern = /^[A-Z]{2}$/
const mapWidth = 1000
const mapHeight = 305
const mapPathTransform = `scale(1 ${mapHeight / 500})`
const worldToRegionalTransform = 'translate(-180 -84) scale(0.36 0.288)'

watch(countryCode, async (code, _, onCleanup) => {
  boundaries.value = []
  if (!code)
    return
  let stale = false
  onCleanup(() => {
    stale = true
  })
  try {
    const shapes = await loadRegionalBoundaries(code)
    if (!stale)
      boundaries.value = shapes
  }
  catch {
    // The original country outlines also provide a regional fallback.
  }
})

// Use the same bounds as the map paths, scaled to the shorter viewBox.
function project([latitude, longitude]: [number, number]): [number, number] {
  const x = (longitude + 180) / 360 * mapWidth
  const y = (84 - Math.min(84, Math.max(-60, latitude))) / 144 * mapHeight
  return [x, y]
}

const countries = computed(() => {
  const regions = new Map<string, CountryMarker>()
  for (const cluster of regionClusters.value) {
    const code = cluster.code.toUpperCase()
    if (!regionCodePattern.test(code))
      continue

    let country = regions.get(code)
    if (!country) {
      country = {
        id: code,
        code,
        label: getRegionDisplayName(code) || code,
        coord: getCoordByCode(code) ?? cluster.coord,
        servers: 0,
        onlineServers: 0,
        subdivisions: [],
      }
      regions.set(code, country)
    }
    country.servers += cluster.servers
    country.onlineServers += cluster.onlineServers
    if (cluster.subdivision)
      country.subdivisions.push(cluster)
  }
  return Array.from(regions.values())
})

function canOpenRegion(marker: RegionMarker): boolean {
  return marker.subdivisions !== undefined && (marker.subdivisions.length > 0 || hasRegionalBoundaries(marker.code))
}

const activeCountry = computed(() => countries.value.find(country => country.code === countryCode.value && canOpenRegion(country)))
const detailsTitle = computed(() => activeCountry.value ? `${activeCountry.value.label}省州详情` : '地区详情')
const markers = computed(() => activeCountry.value?.subdivisions ?? countries.value)
const activeMarker = computed(() => {
  const id = hoveredId.value || focusedId.value || selectedId.value
  return markers.value.find(marker => marker.id === id)
})
const scopeCounts = computed(() => activeCountry.value ?? { servers: totalServers.value, onlineServers: onlineServers.value })
const scopeSummary = computed(() => {
  const area = activeCountry.value && !markers.value.length ? '仅国家定位' : `${markers.value.length} 个${activeCountry.value ? '省州' : '地区'}`
  return `${area} · ${scopeCounts.value.onlineServers} / ${scopeCounts.value.servers} 个节点在线`
})
const unlocated = computed(() => {
  const counts = markers.value.reduce((sum, entry) => ({
    servers: sum.servers - entry.servers,
    onlineServers: sum.onlineServers - entry.onlineServers,
  }), { servers: scopeCounts.value.servers, onlineServers: scopeCounts.value.onlineServers })
  return counts.servers ? counts : null
})

const highlightedRegion = computed(() => {
  const code = activeCountry.value?.code ?? activeMarker.value?.code ?? ''
  return regionBorderFallback[code] ?? code
})
const regionalContext = computed(() => mapPaths.filter(region => region.code !== highlightedRegion.value))

const regionalWidth = computed(() => canvasWidth.value || 500)
const regionalHeight = computed(() => canvasHeight.value || 150)
const worldMarkerScale = computed(() => Math.min(regionalWidth.value / mapWidth, regionalHeight.value / mapHeight))
const regionalViewport = computed(() => fitRegionalMap(
  regionalWidth.value,
  regionalHeight.value,
  activeCountry.value && !markers.value.length
    ? [regionalPoint(activeCountry.value.coord)]
    : markers.value.map(marker => regionalPoint(marker.coord)),
  boundaries.value,
))
const boundaryByMarker = computed(() => new Map(
  markers.value.map(marker => [marker.id, findRegionalBoundary(boundaries.value, marker.id, marker.label)]),
))
const highlightedProvince = computed(() => activeMarker.value && boundaryByMarker.value.get(activeMarker.value.id)?.id)

function markerLabel(marker: RegionMarker) {
  return boundaryByMarker.value.get(marker.id)?.localName || marker.label
}

function markerPosition(marker: RegionMarker) {
  if (activeCountry.value) {
    const [x, y] = regionalPoint(marker.coord)
    const { scale, scaleX, translateX, translateY } = regionalViewport.value
    // The regional viewBox uses screen units. Match the world viewBox's marker scale.
    return `translate(${x * scaleX + translateX} ${y * scale + translateY}) scale(${worldMarkerScale.value})`
  }
  const [x, y] = project(marker.coord)
  return `translate(${x} ${y})`
}

function clearMarker() {
  hoveredId.value = ''
  focusedId.value = ''
  selectedId.value = ''
}

async function toggleMarker(marker: RegionMarker) {
  if (canOpenRegion(marker)) {
    clearMarker()
    countryCode.value = marker.code
    selectedId.value = marker.subdivisions?.[0]?.id ?? ''
    await nextTick()
    detailsTrigger.value?.focus()
    return
  }
  const deselect = !activeCountry.value && selectedId.value === marker.id
  selectedId.value = deselect ? '' : marker.id
}

function chooseDetailsMarker(marker: RegionMarker) {
  detailsOpen.value = false
  void toggleMarker(marker)
}

async function showWorld() {
  const returnId = activeCountry.value?.id
  countryCode.value = ''
  detailsOpen.value = false
  clearMarker()
  await nextTick()
  if (returnId)
    document.getElementById(`${headingId}-${returnId}`)?.focus()
}

watch(markers, (regions) => {
  if (countryCode.value && !activeCountry.value) {
    countryCode.value = ''
    detailsOpen.value = false
    clearMarker()
  }
  for (const id of [hoveredId, focusedId, selectedId]) {
    if (id.value && !regions.some(region => region.id === id.value))
      id.value = ''
  }
  if (activeCountry.value && !selectedId.value)
    selectedId.value = regions[0]?.id ?? ''
})
</script>

<template>
  <section
    class="star-map" :class="{ 'star-map--still': appStore.stopEarth || appStore.disablePageAnimation, 'star-map--province': activeCountry }"
    :aria-labelledby="headingId"
  >
    <div class="star-map__heading">
      <div class="star-map__scope">
        <button v-if="activeCountry" type="button" class="star-map__control star-map__back" aria-label="返回全球" title="返回全球" @click="showWorld">
          <Icon icon="tabler:arrow-left" width="15" height="15" aria-hidden="true" />
        </button>
        <h2 :id="headingId" aria-label="节点地图">
          <img v-if="activeCountry" class="star-map__flag" :src="`/images/flags/${activeCountry.code}.svg`" alt="">
          <Icon v-else icon="tabler:world" width="18" height="18" aria-hidden="true" />
          {{ activeCountry?.label ?? '节点地图' }}
        </h2>
      </div>

      <PopoverRoot v-model:open="detailsOpen">
        <PopoverTrigger as-child>
          <button ref="detailsTrigger" type="button" class="star-map__control star-map__summary" :aria-label="`查看地区详情：${scopeSummary}`">
            {{ scopeSummary }}<Icon icon="tabler:chevron-down" width="13" height="13" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent as-child align="end" :side-offset="7" :collision-padding="12">
            <div
              :aria-label="detailsTitle" aria-labelledby=""
              class="z-50 flex max-h-[min(21rem,var(--reka-popover-content-available-height))] w-72 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none"
            >
              <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
                <div class="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <img v-if="activeCountry" class="star-map__flag" :src="`/images/flags/${activeCountry.code}.svg`" alt="">
                  <h3 class="truncate">
                    {{ detailsTitle }}
                  </h3>
                </div>
                <PopoverClose class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" aria-label="关闭地区详情">
                  <Icon icon="tabler:x" width="15" height="15" aria-hidden="true" />
                </PopoverClose>
              </div>
              <ul v-if="markers.length || unlocated" class="min-h-0 overflow-y-auto p-1.5" aria-label="在线节点分布">
                <li v-for="marker in markers" :key="marker.id">
                  <button
                    type="button"
                    class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    :class="marker.id === selectedId && 'bg-accent/65'"
                    @click="chooseDetailsMarker(marker)"
                  >
                    <Icon v-if="activeCountry" icon="tabler:map-pin" width="17" height="17" class="shrink-0 text-primary" aria-hidden="true" />
                    <img v-else class="star-map__flag" :src="`/images/flags/${marker.code}.svg`" alt="">
                    <span class="min-w-0 flex-1 break-words text-sm font-medium">{{ markerLabel(marker) }}</span>
                    <span class="shrink-0 tabular-nums" :class="marker.onlineServers ? 'text-muted-foreground' : 'text-destructive'">{{ marker.onlineServers }} / {{ marker.servers }} 在线</span>
                    <Icon v-if="canOpenRegion(marker)" icon="tabler:chevron-right" width="13" height="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
                <li v-if="unlocated" class="flex items-center justify-between gap-2 border-t border-border/65 px-2 py-2 text-xs text-muted-foreground">
                  <span>{{ activeCountry ? '仅定位到国家或地区' : '暂无地区信息' }}</span>
                  <span class="shrink-0 tabular-nums">{{ unlocated.onlineServers }} / {{ unlocated.servers }} 在线</span>
                </li>
              </ul>
              <p v-else class="p-3 text-xs text-muted-foreground">
                暂无可定位节点
              </p>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </div>

    <div ref="mapCanvas" class="star-map__canvas">
      <svg
        class="star-map__svg"
        :viewBox="activeCountry ? `0 0 ${regionalWidth} ${regionalHeight}` : `0 0 ${mapWidth} ${mapHeight}`"
        role="group"
        :aria-label="activeCountry ? `${activeCountry.label}省州节点分布` : '节点地区分布'"
      >
        <defs>
          <filter :id="glowId" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g v-if="!activeCountry" class="star-map__grid" :transform="mapPathTransform" aria-hidden="true">
          <path v-for="x in [125, 250, 375, 500, 625, 750, 875]" :key="`x-${x}`" :d="`M${x},15 V485`" />
          <path v-for="y in [100, 200, 300, 400]" :key="`y-${y}`" :d="`M20,${y} H980`" />
        </g>

        <g
          v-if="activeCountry && boundaries.length" class="star-map__context"
          :transform="`${regionalViewport.transform} ${worldToRegionalTransform}`" aria-hidden="true"
        >
          <path v-for="(region, index) in regionalContext" :key="index" :d="region.path" />
        </g>
        <g v-if="activeCountry && boundaries.length" class="star-map__regions" :transform="regionalViewport.transform" aria-hidden="true">
          <path
            v-for="boundary in boundaries" :key="boundary.id" :d="boundary.path"
            :data-map-province-code="boundary.id"
            :class="{ 'is-active': boundary.id === highlightedProvince }"
          />
        </g>
        <g v-else class="star-map__regions" :transform="activeCountry ? `${regionalViewport.transform} ${worldToRegionalTransform}` : mapPathTransform" aria-hidden="true">
          <path
            v-for="(region, index) in mapPaths"
            :key="index"
            :d="region.path"
            :data-map-region-code="region.code || undefined"
            :class="{ 'is-active': region.code && region.code === highlightedRegion }"
            :filter="!activeCountry && region.code && region.code === highlightedRegion ? `url(#${glowId})` : undefined"
          />
        </g>

        <g
          v-for="marker in markers"
          :id="`${headingId}-${marker.id}`"
          :key="marker.id"
          class="star-map__marker"
          :class="{ 'is-active': marker.id === activeMarker?.id, 'is-offline': marker.onlineServers === 0 }"
          :transform="markerPosition(marker)"
          :data-map-marker-code="marker.id"
          role="button"
          tabindex="0"
          :aria-pressed="canOpenRegion(marker) ? undefined : marker.id === selectedId"
          :aria-label="`${markerLabel(marker)}，${marker.onlineServers} / ${marker.servers} 个节点在线${canOpenRegion(marker) ? '，查看省州分布' : ''}`"
          @pointerenter="$event.pointerType === 'mouse' && (hoveredId = marker.id)"
          @pointerleave="hoveredId = ''"
          @focus="focusedId = marker.id"
          @blur="focusedId = ''"
          @click="toggleMarker(marker)"
          @keydown.enter.prevent="toggleMarker(marker)"
          @keydown.space.prevent="toggleMarker(marker)"
          @keydown.esc.stop.prevent="activeCountry ? showWorld() : clearMarker()"
        >
          <circle r="17" fill="transparent" aria-hidden="true" />
          <circle v-if="canOpenRegion(marker)" class="star-map__detail-ring" r="15" aria-hidden="true" />
          <circle class="star-map__pulse" r="12" aria-hidden="true" />
          <circle class="star-map__halo" r="8.5" aria-hidden="true" />
          <circle class="star-map__dot" r="5.2" aria-hidden="true" />
        </g>
      </svg>
    </div>

    <div class="star-map__status" aria-live="polite">
      <template v-if="activeMarker">
        <img class="star-map__flag" :src="`/images/flags/${activeMarker.code}.svg`" alt="">
        <strong>{{ markerLabel(activeMarker) }}</strong>
        <span :class="{ 'is-offline': activeMarker.onlineServers === 0 }">
          {{ activeMarker.onlineServers }} / {{ activeMarker.servers }} 个节点在线
        </span>
        <span v-if="activeMarker.subdivisions?.length">查看 {{ activeMarker.subdivisions.length }} 个省州</span>
        <span v-else-if="canOpenRegion(activeMarker)">查看省州边界</span>
      </template>
      <span v-else-if="activeCountry && !markers.length">节点仅定位到国家或地区</span>
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
  height: clamp(12.75rem, 56vw, 14.5rem);
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
  padding: 0.45rem 0.9rem;
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
  min-height: 2rem;
}

.star-map__status strong {
  color: var(--map-label);
}

.star-map__status .is-offline {
  color: var(--map-offline);
}

.star-map__scope {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.star-map__flag {
  width: 1.1rem;
  height: 0.85rem;
  flex: none;
  border-radius: 2px;
  object-fit: cover;
}

.star-map__control {
  display: inline-flex;
  min-height: 1.5rem;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid color-mix(in srgb, var(--map-coast), transparent 30%);
  border-radius: 0.4rem;
  padding-inline: 0.4rem;
  background: color-mix(in srgb, var(--popover) 80%, transparent);
  color: var(--map-label);
  font: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.star-map__summary {
  min-width: 0;
  text-align: start;
}

.star-map__back {
  min-width: 1.5rem;
  justify-content: center;
  padding-inline: 0;
}

.star-map__control:hover,
.star-map__control[aria-expanded='true'] {
  background: var(--popover);
}

.star-map__control:focus-visible {
  outline: 2px solid var(--map-label);
  outline-offset: 1px;
}

.star-map__canvas {
  position: relative;
  min-height: 0;
  padding-inline: 0.4rem;
}

.star-map__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
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

.star-map__context path {
  fill: var(--map-fill);
  fill-rule: evenodd;
  stroke: var(--map-coast);
  stroke-width: 0.65;
  vector-effect: non-scaling-stroke;
  opacity: 0.42;
}

.star-map--province .star-map__regions path {
  stroke-width: 0.75;
  vector-effect: non-scaling-stroke;
}

.star-map--province .star-map__regions .is-active {
  stroke-width: 1.35;
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

.star-map__detail-ring {
  fill: none;
  stroke: var(--marker-edge);
  stroke-width: 1.65;
  stroke-dasharray: 2 4;
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

  .star-map__summary {
    font-size: 0.72rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .star-map__pulse {
    animation: none;
    opacity: 0.55;
  }
}
</style>
