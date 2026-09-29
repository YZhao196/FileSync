import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compactBytes,
  formatClock,
  formatDate,
  formatUptime,
  percent,
  usedOverTotal,
} from './format'

const GIB = 1024 ** 3
const MIB = 1024 ** 2

describe('compactBytes', () => {
  it('scales to the largest sensible unit', () => {
    expect(compactBytes(512)).toBe('512 B')
    expect(compactBytes(2048)).toBe('2 KB')
    expect(compactBytes(240 * GIB)).toBe('240 GB')
    expect(compactBytes(1024 * GIB)).toBe('1 TB')
  })

  it('keeps one decimal below ten of a unit', () => {
    expect(compactBytes(1.5 * MIB)).toBe('1.5 MB')
    expect(compactBytes(86 * GIB)).toBe('86 GB')
  })

  it('rounds rather than showing spurious precision', () => {
    expect(compactBytes(1_258_291)).toBe('1.2 MB')
  })
})

describe('usedOverTotal', () => {
  it('formats each side independently', () => {
    expect(usedOverTotal(240 * GIB, 1024 * GIB)).toBe('240 GB / 1 TB')
    expect(usedOverTotal(86 * GIB, 512 * GIB)).toBe('86 GB / 512 GB')
  })
})

describe('percent', () => {
  it('computes a clamped percentage', () => {
    expect(percent(50, 100)).toBe(50)
    expect(percent(0, 100)).toBe(0)
    expect(percent(200, 100)).toBe(100)
  })

  it('does not divide by zero when a drive reports no size', () => {
    expect(percent(10, 0)).toBe(0)
  })
})

describe('formatUptime', () => {
  it('shows hours when under a day', () => {
    expect(formatUptime(5 * 3600)).toBe('5 h')
  })

  it('shows days and hours otherwise', () => {
    expect(formatUptime(23 * 86400 + 14 * 3600)).toBe('23 days, 14 h')
  })
})

describe('formatClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels today and tomorrow rather than dating them', () => {
    expect(formatClock('2026-09-12T03:14:00')).toBe('Today 03:14')
    expect(formatClock('2026-09-13T03:14:00')).toBe('Tomorrow 03:14')
    expect(formatClock('2026-09-11T03:14:00')).toBe('Yesterday 03:14')
  })

  it('dates anything further out', () => {
    // Deliberately locale-aware: a desktop app should follow the OS, so this
    // checks the date is right rather than the order the locale prints it in.
    const out = formatClock('2026-09-08T03:14:00')
    expect(out).toMatch(/03:14/)
    expect(out).toMatch(/Sep/)
    expect(out).not.toMatch(/^(Today|Tomorrow|Yesterday)/)
  })

  it('says Never rather than an epoch date', () => {
    expect(formatClock(null)).toBe('Never')
  })

  it('does not print Invalid Date for unparseable input', () => {
    expect(formatClock('not a date')).toBe('Unknown')
  })
})

describe('formatDate', () => {
  it('renders a long date', () => {
    const out = formatDate('2026-08-18T00:00:00')
    expect(out).toMatch(/18/)
    expect(out).toMatch(/Aug/)
    expect(out).toMatch(/2026/)
  })

  it('handles missing input', () => {
    expect(formatDate(null)).toBe('Unknown')
  })
})
