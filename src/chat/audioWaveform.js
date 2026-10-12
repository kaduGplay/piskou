export function waveformPeaks(samples, count = 40) {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * samples.length / count)
    const end = Math.floor((index + 1) * samples.length / count)
    let peak = 0
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]))
    return Math.min(1, peak)
  })
}
export function audioTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
