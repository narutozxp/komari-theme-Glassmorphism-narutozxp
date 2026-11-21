const CURRENCIES = {
  CNY: { symbol: '¥', name: '人民币' },
  USD: { symbol: '$', name: '美元' },
  HKD: { symbol: 'HK$', name: '港元' },
  EUR: { symbol: '€', name: '欧元' },
  GBP: { symbol: '£', name: '英镑' },
  JPY: { symbol: '¥', name: '日元' },
  RUB: { symbol: '₽', name: '卢布' },
  CHF: { symbol: '₣', name: '瑞士法郎' },
  INR: { symbol: '₹', name: '印度卢比' },
  VND: { symbol: '₫', name: '越南盾' },
  THB: { symbol: '฿', name: '泰铢' },
  CAD: { symbol: 'CA$', name: '加元' },
}

export type CurrencyCode = keyof typeof CURRENCIES
export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES) as CurrencyCode[]

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

export function getCurrencyName(code: CurrencyCode): string {
  return CURRENCIES[code].name
}

export function getCurrencyDisplaySymbol(currency: string | null | undefined): string {
  const value = currency?.trim() || 'CNY'
  const code = value.toUpperCase()
  const supportedCode = SUPPORTED_CURRENCIES.find(item => item === code)
  if (supportedCode)
    return CURRENCIES[supportedCode].symbol

  if (!CURRENCY_CODE_PATTERN.test(code))
    return value

  const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    .formatToParts(0)
    .find(part => part.type === 'currency')
    ?.value
  if (symbol && symbol !== code)
    return symbol

  const narrowSymbol = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find(part => part.type === 'currency')
    ?.value
  return narrowSymbol && narrowSymbol !== code ? narrowSymbol : value
}
