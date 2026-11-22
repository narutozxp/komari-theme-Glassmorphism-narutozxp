type Location = [city: string, subdivision: string, lat: number, lng: number]

interface ExtraDemoNode {
  code: string
  name: string
  cpu: string
  location?: Location
}

// The first four regions are repeated in the visual fixture's second group.
const baseLocations: Array<[countryCode: string, ...Location]> = [
  ['US', 'Los Angeles', 'California', 34.052, -118.244],
  ['HK', '将军澳', 'Sai Kung', 22.305, 114.264],
  ['JP', 'Tokyo', 'Tokyo', 35.676, 139.65],
  ['SG', '裕廊西', 'South West Community Development Council', 1.34, 103.706],
  ['DE', 'Frankfurt', 'Hesse', 50.111, 8.682],
  ['GB', 'London', 'London', 51.514, -0.092],
  ['TW', 'Taipei', 'Taipei', 25.046, 121.517],
  ['AU', 'Sydney', 'New South Wales', -33.868, 151.209],
]

const extraNodes: ExtraDemoNode[] = [
  { code: 'CN-SH', name: '上海-骨干节点', cpu: 'AMD EPYC 9654' },
  { code: 'KR', name: '首尔-亚太边缘', cpu: 'AMD EPYC 7443P', location: ['Seoul', 'Seoul', 37.566, 126.978] },
  { code: 'IN', name: '孟买-南亚节点', cpu: 'Intel Xeon Gold 6338', location: ['Mumbai', 'Maharashtra', 19.076, 72.878] },
  { code: 'MY', name: '吉隆坡-东南亚中继', cpu: 'AMD EPYC 7313P', location: ['Kuala Lumpur', 'Kuala Lumpur', 3.139, 101.687] },
  { code: 'CA', name: '多伦多-北美备份', cpu: 'Intel Xeon Silver 4314', location: ['Toronto', 'Ontario', 43.653, -79.383] },
  { code: 'BR', name: '圣保罗-南美节点', cpu: 'AMD EPYC 7453', location: ['São Paulo', 'São Paulo', -23.551, -46.633] },
  { code: 'ZA', name: '约翰内斯堡-非洲节点', cpu: 'Intel Xeon Gold 6230', location: ['Johannesburg', 'Gauteng', -26.205, 28.049] },
  { code: 'AE', name: '迪拜-中东中继', cpu: 'AMD EPYC 7543P', location: ['Dubai', 'Emirate of Dubai', 25.205, 55.271] },
  { code: 'FR', name: '马赛-地中海中继', cpu: 'Intel Xeon Gold 6426Y', location: ['马赛', 'Bouches-du-Rhône', 43.31, 5.372] },
  { code: 'NL', name: '阿姆斯特丹-欧洲交换', cpu: 'AMD EPYC 9454P', location: ['Amsterdam', 'North Holland', 52.367, 4.904] },
  { code: 'CN-BJ', name: '北京-华北节点', cpu: 'AMD EPYC 7513' },
  { code: 'CN-GD', name: '广东-华南节点', cpu: 'Intel Xeon Gold 6338' },
  { code: 'CN-SC', name: '四川-西南节点', cpu: 'AMD EPYC 7443P' },
]

export function demoNodeId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}

export const demoExtraRegions = extraNodes.map(({ code, name, cpu }) => ({ code, name, cpu }))

const locations = [
  ...baseLocations,
  ...baseLocations.slice(0, 4),
  ...extraNodes.map(({ code, location }) => location ? [code, ...location] as const : undefined),
]

export const demoNodeLocations = Object.fromEntries(locations.flatMap((location, index) => {
  if (!location)
    return []
  const [countryCode, city, subdivision, lat, lng] = location
  return [[demoNodeId(index + 1), { countryCode, city, subdivision, lat, lng }] as const]
}))
