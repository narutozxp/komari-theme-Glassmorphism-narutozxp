import regionalMapCountries from '@/assets/regional-map-countries.json'

type Point = [x: number, y: number]
type Bounds = [left: number, top: number, right: number, bottom: number]

export interface RegionalBoundary {
  id: string
  name: string
  localName: string
  bounds: Bounds
  path: string
}

export type RegionalMapData = Partial<Record<string, RegionalBoundary[]>>

const mapPacks = import.meta.glob<RegionalMapData>('../assets/regional-maps/*.json', { import: 'default' })
const regionalMapCodes = new Set(regionalMapCountries)

export function hasRegionalBoundaries(country: string): boolean {
  return regionalMapCodes.has(country)
}

export async function loadRegionalBoundaries(country: string): Promise<RegionalBoundary[]> {
  const load = mapPacks[`../assets/regional-maps/${country[0]?.toLowerCase()}.json`]
  return (await load?.())?.[country] ?? []
}

function include(bounds: Bounds, left: number, top: number, right: number, bottom: number): Bounds {
  return [Math.min(bounds[0], left), Math.min(bounds[1], top), Math.max(bounds[2], right), Math.max(bounds[3], bottom)]
}

function includeBoundaries(bounds: Bounds, boundaries: RegionalBoundary[]): Bounds {
  return boundaries.reduce((result, boundary) => {
    const [left, top, right, bottom] = boundary.bounds
    return include(result, left, top, right, bottom)
  }, bounds)
}

export function regionalPoint([latitude, longitude]: [number, number]): Point {
  return [longitude, -latitude]
}

export function fitRegionalMap(width: number, height: number, points: Point[], boundaries: RegionalBoundary[]) {
  const [x, y] = points[0] ?? [0, 0]
  const markers = points.reduce((bounds, [x, y]) => include(bounds, x, y, x, y), [x, y, x, y] as Bounds)
  let visibleBoundaries = boundaries
  let bounds = includeBoundaries(markers, visibleBoundaries)

  // If the country spans distant territories, fit the part near its nodes.
  if (bounds[2] - bounds[0] > 95 || bounds[3] - bounds[1] > 48) {
    visibleBoundaries = boundaries.filter(({ bounds: [left, top, right, bottom] }) => {
      const x = (left + right) / 2
      const y = (top + bottom) / 2
      return right - left < 75 && x >= markers[0] - 28 && x <= markers[2] + 28
        && y >= markers[1] - 15 && y <= markers[3] + 15
    })
    bounds = includeBoundaries(markers, visibleBoundaries)
  }

  const [left, top, right, bottom] = bounds
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  const longitudeScale = Math.max(0.35, Math.cos(centerY * Math.PI / 180))
  const minimumSpan = visibleBoundaries.length ? 0.35 : 14
  const scale = Math.min(
    Math.max(width - 28, 1) / (Math.max(right - left, minimumSpan) * longitudeScale),
    Math.max(height - 18, 1) / Math.max(bottom - top, minimumSpan),
  )
  const scaleX = scale * longitudeScale
  const translateX = width / 2 - centerX * scaleX
  const translateY = height / 2 - centerY * scale

  return { transform: `translate(${translateX} ${translateY}) scale(${scaleX} ${scale})`, scale, scaleX, translateX, translateY }
}

export function findRegionalBoundary(boundaries: RegionalBoundary[], id: string, label: string) {
  const name = label.normalize('NFKC').trim().toLowerCase()
  return boundaries.find(boundary => boundary.id === id || name === boundary.name.toLowerCase() || name === boundary.localName.toLowerCase())
}
