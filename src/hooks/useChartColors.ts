import { useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

/**
 * Cores dos gráficos lidas dos tokens CSS. O SVG do Recharts recebe valores
 * concretos; recalcula quando o tema muda.
 */
export function useChartColors() {
  const { resolved } = useTheme()
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const v = (name: string) => css.getPropertyValue(name).trim()
    return {
      series1: v('--chart-1'),
      series2: v('--chart-2'),
      grid: v('--chart-grid'),
      axis: v('--chart-axis'),
      surface: v('--surface'),
      text: v('--text'),
      textSecondary: v('--text-secondary')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved])
}
