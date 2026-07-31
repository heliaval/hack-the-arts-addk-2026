import { useEffect, useState } from 'react'
import { loadDemographics, type CountryDemographics } from '@/lib/worldbank'

type State =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: Map<string, CountryDemographics> }

export function useDemographics(): State {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadDemographics().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data })
      },
      (error: Error) => {
        if (!cancelled) setState({ status: 'error', error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
