interface ChinaProvince {
  code: string
  label: string
  name: string
  coord: [number, number]
}

// Approximate label coordinates from Natural Earth 5.1.1, Admin 1 – States, Provinces.
const provinces: Array<[string, string, string, number, number]> = [
  ['AH', '安徽省', 'Anhui', 31.954, 117.253],
  ['BJ', '北京市', 'Beijing', 39.949, 116.389],
  ['CQ', '重庆市', 'Chongqing', 30.017, 107.73],
  ['FJ', '福建省', 'Fujian', 26.408, 118.178],
  ['GD', '广东省', 'Guangdong', 23.792, 113.72],
  ['GS', '甘肃省', 'Gansu', 38.739, 100.735],
  ['GX', '广西壮族自治区', 'Guangxi', 23.745, 108.756],
  ['GZ', '贵州省', 'Guizhou', 26.803, 106.559],
  ['HA', '河南省', 'Henan', 33.906, 113.484],
  ['HB', '湖北省', 'Hubei', 30.986, 112.264],
  ['HE', '河北省', 'Hebei', 38.521, 115.314],
  ['HI', '海南省', 'Hainan', 19.187, 109.825],
  ['HL', '黑龙江省', 'Heilongjiang', 46.845, 127.97],
  ['HN', '湖南省', 'Hunan', 27.667, 111.712],
  ['JL', '吉林省', 'Jilin', 43.298, 126.466],
  ['JS', '江苏省', 'Jiangsu', 32.984, 119.942],
  ['JX', '江西省', 'Jiangxi', 27.64, 116.017],
  ['LN', '辽宁省', 'Liaoning', 41.386, 123.07],
  ['NM', '内蒙古自治区', 'Inner Mongolia', 41.594, 111.623],
  ['NX', '宁夏回族自治区', 'Ningxia', 37.176, 106.038],
  ['QH', '青海省', 'Qinghai', 35.265, 96.238],
  ['SC', '四川省', 'Sichuan', 30.543, 102.384],
  ['SD', '山东省', 'Shandong', 36.327, 118.114],
  ['SH', '上海市', 'Shanghai', 31.091, 121.409],
  ['SN', '陕西省', 'Shaanxi', 33.771, 108.363],
  ['SX', '山西省', 'Shanxi', 37.759, 112.389],
  ['TJ', '天津市', 'Tianjin', 39.371, 117.347],
  ['XJ', '新疆维吾尔自治区', 'Xinjiang', 41.122, 85.425],
  ['XZ', '西藏自治区', 'Tibet', 31.452, 88.414],
  ['YN', '云南省', 'Yunnan', 24.46, 101.661],
  ['ZJ', '浙江省', 'Zhejiang', 29.108, 119.97],
]

const suffix = /(?:壮族自治区|维吾尔自治区|回族自治区|自治区|省|市|\s+(?:province|municipality|sheng|shi))$/i

function normalizeProvince(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(suffix, '')
}

const byName = new Map<string, ChinaProvince>()
for (const [shortCode, label, name, latitude, longitude] of provinces) {
  const code = `CN-${shortCode}`
  const province: ChinaProvince = { code, label, name, coord: [latitude, longitude] }
  for (const key of [code, label, name])
    byName.set(normalizeProvince(key), province)
}

export function findChinaProvince(value: string) {
  return byName.get(normalizeProvince(value))
}

export function getChinaProvinceFromRegion(value: string | null | undefined) {
  const region = value?.trim().toUpperCase()
  return region?.startsWith('CN-') ? findChinaProvince(region) : undefined
}
