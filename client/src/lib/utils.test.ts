import { describe, it, expect } from 'vitest'
import { formatBytes } from './utils'

describe('formatBytes utility tests', () => {
  it('should format 0 bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('should format bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('should format kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('should format megabytes correctly', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB')
  })

  it('should format gigabytes correctly', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatBytes(1024 * 1024 * 1024 * 12.345)).toBe('12.35 GB')
  })
})
