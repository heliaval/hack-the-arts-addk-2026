import { useEffect, useRef, useState } from 'react'
import type { CountryDemographics } from '@/lib/worldbank'

// Real per-second birth/death rates are all well under 1/s even for the
// most populous countries. A threshold of 3 puts the busiest cities at
// roughly an 8-10s pulse cadence; quiet countries will rarely pulse in a
// short session -- expected, this is literal real-time pacing, not
// artificially sped up.
export const PULSE_THRESHOLD = 3
const TICK_MS = 500
export const PULSE_DURATION_MS = 1800

export interface PulseCity {
  id: string
  country: string
}

export interface PopulationPulse {
  id: string
  cityId: string
  kind: 'birth' | 'death'
}

// Ticks on a plain setInterval rather than requestAnimationFrame (unlike
// most of this app's per-frame work) -- this needs to keep accumulating in
// real wall-clock time regardless of animation-frame availability.
export function usePopulationPulses(
  cities: PulseCity[],
  visibleCityIds: Set<string>,
  demographics: Map<string, CountryDemographics>,
): PopulationPulse[] {
  const [pulses, setPulses] = useState<PopulationPulse[]>([])
  const accumulators = useRef<Map<string, { birth: number; death: number }>>(new Map())
  const nextId = useRef(0)
  const lastTick = useRef(Date.now())

  useEffect(() => {
    const countryCounts = new Map<string, number>()
    for (const c of cities) {
      countryCounts.set(c.country, (countryCounts.get(c.country) ?? 0) + 1)
    }

    lastTick.current = Date.now()
    const interval = window.setInterval(() => {
      const now = Date.now()
      const elapsed = (now - lastTick.current) / 1000
      lastTick.current = now

      const newPulses: PopulationPulse[] = []
      for (const city of cities) {
        if (!visibleCityIds.has(city.id)) continue
        const country = demographics.get(city.country)
        if (!country) continue
        const divisor = countryCounts.get(city.country) ?? 1

        let acc = accumulators.current.get(city.id)
        if (!acc) {
          acc = { birth: 0, death: 0 }
          accumulators.current.set(city.id, acc)
        }

        acc.birth += elapsed * (country.birthsPerSecond / divisor)
        while (acc.birth >= PULSE_THRESHOLD) {
          acc.birth -= PULSE_THRESHOLD
          newPulses.push({ id: `pulse-${nextId.current++}`, cityId: city.id, kind: 'birth' })
        }

        acc.death += elapsed * (country.deathsPerSecond / divisor)
        while (acc.death >= PULSE_THRESHOLD) {
          acc.death -= PULSE_THRESHOLD
          newPulses.push({ id: `pulse-${nextId.current++}`, cityId: city.id, kind: 'death' })
        }
      }

      if (newPulses.length > 0) {
        setPulses((prev) => [...prev, ...newPulses])
        for (const p of newPulses) {
          window.setTimeout(() => {
            setPulses((prev) => prev.filter((x) => x.id !== p.id))
          }, PULSE_DURATION_MS)
        }
      }
    }, TICK_MS)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demographics, visibleCityIds])

  return pulses
}
