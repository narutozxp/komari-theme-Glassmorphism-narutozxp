/**
 * 根据 IP 在线查询地理坐标与城市，用于地球的城市级定位。
 *
 * 多个 HTTPS 服务依次回退（默认 ip.sb → ipinfo.io → ipwho.is → ipapi.co，可在主题设置里改），
 * 优先采用首个有效坐标，省州地图可从后续同国家结果补齐行政区；
 * 结果按 IP 缓存到 localStorage（带版本与过期时间），避免重复请求与频率限制。
 * 全部失败时写入短期负缓存，调用方应回落到国家级定位。
 */

import { isPublicIp } from '@/utils/ipAddress'
import { DEFAULT_IP_GEO_PROVIDER_URLS } from '@/utils/ipGeoProviders'
import { hasRegionalBoundaries } from '@/utils/regionalMap'
import { getRegionDisplayName } from '@/utils/regionHelper'

export interface IpGeo {
  lat: number
  lng: number
  city?: string
  subdivision?: string
  subdivisionCoord?: [number, number]
  countryCode?: string
  /** ASN 组织 / ISP 名称（用于识别厂商） */
  org?: string
  /** AS 号，如 "AS401115" */
  asn?: string
}

const CACHE_PREFIX = 'komari-theme-emerald:ipgeo'
const CACHE_VERSION = 6
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 小时
const IP_GEO_TIMEOUT_MS = 5000
const IP_PLACEHOLDER_REGEX = /\{ip\}/gi
const PROVIDER_BACKOFF_BASE_MS = 60 * 1000
const PROVIDER_BACKOFF_MAX_MS = 30 * 60 * 1000
const ASN_ORG_PREFIX_REGEX = /^AS\d+/

interface CacheEntry {
  version: number
  updatedAt: number
  geo: IpGeo | null
  negative?: boolean
}

interface ProviderState {
  failures: number
  blockedUntil: number
}

type Provider = (ip: string, template: string) => Promise<IpGeo | null>

interface ProviderEntry {
  id: string
  lookup: Provider
}

function cacheKey(ip: string, configuration: string): string {
  return `${CACHE_PREFIX}:${encodeURIComponent(configuration)}:${ip}`
}

function validCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0)
}

function isValidGeo(geo: unknown): geo is IpGeo {
  if (!geo || typeof geo !== 'object')
    return false
  const g = geo as Record<string, unknown>
  return validCoordinates(g.lat, g.lng)
    && (g.countryCode === undefined || typeof g.countryCode === 'string')
    && (g.subdivision === undefined || typeof g.subdivision === 'string')
    && (g.subdivisionCoord === undefined || (Array.isArray(g.subdivisionCoord) && g.subdivisionCoord.length === 2 && validCoordinates(g.subdivisionCoord[0], g.subdivisionCoord[1])))
}

export function getIpGeoSubdivision(geo: IpGeo | undefined): string | undefined {
  const name = geo?.subdivision?.normalize('NFKC').trim()
  if (!name)
    return undefined
  const code = geo?.countryCode?.trim().toUpperCase()
  const countryNames = code ? [code, getRegionDisplayName(code), getRegionDisplayName(code, 'en')] : []
  return countryNames.some(country => country.toLowerCase() === name.toLowerCase()) ? undefined : name
}

function readCache(ip: string, configuration: string, preferSubdivision: boolean): { geo: IpGeo | null } | null {
  if (typeof window === 'undefined')
    return null
  try {
    const raw = window.localStorage.getItem(cacheKey(ip, configuration))
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (parsed.version !== CACHE_VERSION)
      return null

    const age = Date.now() - parsed.updatedAt
    if (parsed.negative)
      return age <= NEGATIVE_CACHE_TTL_MS ? { geo: null } : null
    if (!isValidGeo(parsed.geo))
      return null
    const partial = preferSubdivision && hasRegionalBoundaries(parsed.geo.countryCode?.trim().toUpperCase() ?? '') && !getIpGeoSubdivision(parsed.geo)
    return age <= (partial ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS) ? { geo: parsed.geo } : null
  }
  catch {
    return null
  }
}

function writeCache(ip: string, configuration: string, geo: IpGeo): void {
  writeCacheEntry(ip, configuration, { version: CACHE_VERSION, updatedAt: Date.now(), geo })
}

function writeNegativeCache(ip: string, configuration: string): void {
  writeCacheEntry(ip, configuration, { version: CACHE_VERSION, updatedAt: Date.now(), geo: null, negative: true })
}

function writeCacheEntry(ip: string, configuration: string, entry: CacheEntry): void {
  if (typeof window === 'undefined')
    return
  try {
    window.localStorage.setItem(cacheKey(ip, configuration), JSON.stringify(entry))
  }
  catch {
    // 忽略写盘失败（隐私模式 / 配额已满）
  }
}

function toFinite(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseFloat(value) : (value as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim())
      return v.trim()
  }
  return undefined
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await response.json()
    return data && typeof data === 'object' ? data as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

async function fetchWithTimeout(url: string, timeoutMs = IP_GEO_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  }
  finally {
    window.clearTimeout(timeoutId)
  }
}

function normalizeIpPath(ip: string): string {
  return encodeURIComponent(ip.trim())
}

/** 把 URL 模板里的 `{ip}` 换成目标 IP 并做百分号编码。 */
function fillIpPlaceholder(template: string, ip: string): string {
  return template.replace(IP_PLACEHOLDER_REGEX, () => normalizeIpPath(ip))
}

/** ip.sb：返回 latitude / longitude / city / country_code */
const fromIpSb: Provider = async (ip) => {
  const res = await fetchWithTimeout(`https://api.ip.sb/geoip/${normalizeIpPath(ip)}`)
  if (!res.ok)
    return null
  const d = await safeJson(res)
  if (!d)
    return null
  const lat = toFinite(d.latitude)
  const lng = toFinite(d.longitude)
  if (lat === null || lng === null)
    return null
  return {
    lat,
    lng,
    city: typeof d.city === 'string' ? d.city : undefined,
    subdivision: pickString(d.region),
    countryCode: typeof d.country_code === 'string' ? d.country_code : undefined,
    org: pickString(d.organization, d.asn_organization, d.isp),
    asn: typeof d.asn === 'number' ? `AS${d.asn}` : pickString(d.asn),
  }
}

/** ipinfo.io：loc = "lat,lng"，city，country，org = "AS#### 组织名" */
const fromIpinfo: Provider = async (ip) => {
  const res = await fetchWithTimeout(`https://ipinfo.io/${normalizeIpPath(ip)}/json`)
  if (!res.ok)
    return null
  const d = await safeJson(res)
  if (!d || typeof d.loc !== 'string')
    return null
  const [latStr, lngStr] = d.loc.split(',')
  const lat = toFinite(latStr)
  const lng = toFinite(lngStr)
  if (lat === null || lng === null)
    return null
  const org = pickString(d.org)
  return {
    lat,
    lng,
    city: typeof d.city === 'string' ? d.city : undefined,
    subdivision: pickString(d.region),
    countryCode: typeof d.country === 'string' ? d.country : undefined,
    org,
    asn: org?.match(ASN_ORG_PREFIX_REGEX)?.[0],
  }
}

/** ipapi.co：latitude / longitude / city / country_code */
const fromIpapiCo: Provider = async (ip) => {
  const res = await fetchWithTimeout(`https://ipapi.co/${normalizeIpPath(ip)}/json/`)
  if (!res.ok)
    return null
  const d = await safeJson(res)
  if (!d)
    return null
  const lat = toFinite(d.latitude)
  const lng = toFinite(d.longitude)
  if (lat === null || lng === null)
    return null
  return {
    lat,
    lng,
    city: typeof d.city === 'string' ? d.city : undefined,
    subdivision: pickString(d.region),
    countryCode: typeof d.country_code === 'string' ? d.country_code : undefined,
    org: pickString(d.org),
    asn: pickString(d.asn),
  }
}

/** ipwho.is：latitude/longitude/city/country_code，connection.{org,isp,asn} */
const fromIpwhois: Provider = async (ip) => {
  const res = await fetchWithTimeout(`https://ipwho.is/${normalizeIpPath(ip)}`)
  if (!res.ok)
    return null
  const d = await safeJson(res)
  if (!d || d.success === false)
    return null
  const lat = toFinite(d.latitude)
  const lng = toFinite(d.longitude)
  if (lat === null || lng === null)
    return null
  const conn = (d.connection ?? {}) as Record<string, unknown>
  return {
    lat,
    lng,
    city: typeof d.city === 'string' ? d.city : undefined,
    subdivision: pickString(d.region),
    countryCode: typeof d.country_code === 'string' ? d.country_code : undefined,
    org: pickString(conn.org, conn.isp),
    asn: typeof conn.asn === 'number' ? `AS${conn.asn}` : pickString(conn.asn),
  }
}

const PROVIDERS: ProviderEntry[] = [
  { id: 'ip.sb', lookup: fromIpSb },
  { id: 'ipinfo.io', lookup: fromIpinfo },
  { id: 'ipwho.is', lookup: fromIpwhois },
  { id: 'ipapi.co', lookup: fromIpapiCo },
]

/** URL 模板 → 内置解析器；自定义地址走通用解析。 */
const BUILTIN_BY_URL = new Map<string, ProviderEntry>([
  ['https://api.ip.sb/geoip/{ip}', PROVIDERS[0]!],
  ['https://ipinfo.io/{ip}/json', PROVIDERS[1]!],
  ['https://ipwho.is/{ip}', PROVIDERS[2]!],
  ['https://ipapi.co/{ip}/json/', PROVIDERS[3]!],
])

/**
 * 通用解析：兼容常见 geo 接口字段名。管理员自建接口只要返回下列任一组合即可，
 * 无需主题侧再做适配。
 */
const fromGenericJson: Provider = async (ip, template) => {
  const res = await fetchWithTimeout(fillIpPlaceholder(template, ip))
  if (!res.ok)
    return null
  const d = await safeJson(res)
  if (!d)
    return null

  const loc = typeof d.loc === 'string' ? d.loc.split(',') : []
  const lat = toFinite(d.latitude) ?? toFinite(d.lat) ?? toFinite(loc[0])
  const lng = toFinite(d.longitude) ?? toFinite(d.lon) ?? toFinite(d.lng) ?? toFinite(loc[1])
  if (lat === null || lng === null)
    return null

  const conn = (d.connection ?? {}) as Record<string, unknown>
  const rawAsn = typeof d.asn === 'number' ? `AS${d.asn}` : d.asn
  return {
    lat,
    lng,
    city: pickString(d.city),
    subdivision: pickString(d.subdivision, d.province, d.state, d.region),
    countryCode: pickString(d.country_code, d.country),
    org: pickString(d.org, d.organization, d.isp, conn.org, conn.isp),
    asn: pickString(rawAsn, conn.asn),
  }
}

/** 当前生效的 URL 回退链；空数组表示只用后台 region。 */
let activeProviderUrls: string[] = [...DEFAULT_IP_GEO_PROVIDER_URLS]

export function setIpGeoProviderUrls(urls: string[] | null): void {
  activeProviderUrls = urls === null ? [...DEFAULT_IP_GEO_PROVIDER_URLS] : [...urls]
}

const providerStates = new Map<string, ProviderState>()

interface ResolvedProvider extends ProviderEntry {
  template: string
}

function orderedProviders(urls: string[]): ResolvedProvider[] {
  // 配置为空时表示「只用后台 region」，不发起任何在线查询。
  if (!urls.length)
    return []
  const providers = urls
    .map(url => ({ ...(BUILTIN_BY_URL.get(url) ?? { id: url, lookup: fromGenericJson }), template: url }))
  const now = Date.now()
  const available = providers.filter(provider => (providerStates.get(provider.id)?.blockedUntil ?? 0) <= now)
  return available.length > 0 ? available : providers
}

function markProviderSuccess(id: string): void {
  providerStates.delete(id)
}

function markProviderFailure(id: string): void {
  const current = providerStates.get(id) ?? { failures: 0, blockedUntil: 0 }
  const failures = current.failures + 1
  const backoff = Math.min(PROVIDER_BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 5), PROVIDER_BACKOFF_MAX_MS)
  providerStates.set(id, { failures, blockedUntil: Date.now() + backoff })
}

// 同一 IP 的并发查询去重
const inflight = new Map<string, Promise<IpGeo | null>>()

/**
 * 查询某个 IP 的地理坐标（含缓存与多服务回退）。失败返回 null。
 */
export async function lookupIpGeo(ip: string, preferSubdivision = false): Promise<IpGeo | null> {
  const normalizedIp = ip.trim()
  const urls = [...activeProviderUrls]
  if (!isPublicIp(normalizedIp) || !urls.length)
    return null

  const configuration = JSON.stringify(preferSubdivision ? { urls, preferSubdivision } : urls)
  const key = cacheKey(normalizedIp, configuration)
  const cached = readCache(normalizedIp, configuration, preferSubdivision)
  if (cached)
    return cached.geo

  const existing = inflight.get(key)
  if (existing)
    return existing

  const task = (async () => {
    let primary: IpGeo | undefined
    for (const provider of orderedProviders(urls)) {
      try {
        const geo = await provider.lookup(normalizedIp, provider.template)
        if (!geo || !isValidGeo(geo)) {
          markProviderFailure(provider.id)
          continue
        }
        markProviderSuccess(provider.id)
        const country = geo.countryCode?.trim().toUpperCase()
        const subdivision = getIpGeoSubdivision(geo)
        if (!primary) {
          primary = geo
          if (!preferSubdivision || subdivision || !country || !hasRegionalBoundaries(country))
            break
        }
        else if (subdivision && country === primary.countryCode?.trim().toUpperCase()) {
          primary = { ...primary, subdivision, subdivisionCoord: [geo.lat, geo.lng] }
          break
        }
      }
      catch {
        markProviderFailure(provider.id)
      }
    }
    if (primary) {
      writeCache(normalizedIp, configuration, primary)
      return primary
    }
    writeNegativeCache(normalizedIp, configuration)
    return null
  })()

  inflight.set(key, task)
  try {
    return await task
  }
  finally {
    inflight.delete(key)
  }
}
