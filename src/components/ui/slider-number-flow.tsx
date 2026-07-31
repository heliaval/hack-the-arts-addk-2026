import NumberFlow from '@number-flow/react'
import * as RadixSlider from '@radix-ui/react-slider'
import clsx from 'clsx'

interface SliderProps extends RadixSlider.SliderProps {
  /** Unit suffix shown after the live NumberFlow readout, e.g. "km/s". */
  unit?: string
}

// Adapted from the pasted reference component: restyled off this app's own
// instrument-panel tokens (--accent, --card, font-mono) instead of the
// original's hardcoded zinc/black-and-white palette.
export default function Slider({ value, className, unit, ...props }: SliderProps) {
  return (
    <RadixSlider.Root
      {...props}
      value={value}
      className={clsx(className, 'relative flex h-5 w-full touch-none select-none items-center')}
    >
      <RadixSlider.Track className="relative h-[3px] grow rounded-full bg-border">
        <RadixSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        className="relative block size-3.5 rounded-full border border-accent bg-card shadow-sm"
        aria-label={props['aria-label']}
      >
        {value?.[0] != null && (
          <NumberFlow
            willChange
            value={value[0]}
            isolate
            opacityTiming={{
              duration: 250,
              easing: 'ease-out',
            }}
            transformTiming={{
              easing: `linear(0, 0.0033 0.8%, 0.0263 2.39%, 0.0896 4.77%, 0.4676 15.12%, 0.5688, 0.6553, 0.7274, 0.7862, 0.8336 31.04%, 0.8793, 0.9132 38.99%, 0.9421 43.77%, 0.9642 49.34%, 0.9796 55.71%, 0.9893 62.87%, 0.9952 71.62%, 0.9983 82.76%, 0.9996 99.47%)`,
              duration: 500,
            }}
            suffix={unit ? ` ${unit}` : undefined}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-xs font-medium text-foreground"
          />
        )}
      </RadixSlider.Thumb>
    </RadixSlider.Root>
  )
}

export { Slider }
