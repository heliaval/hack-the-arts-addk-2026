import * as RadixSlider from '@radix-ui/react-slider'
import clsx from 'clsx'

// Adapted from the pasted reference component: restyled off this app's own
// instrument-panel tokens (--accent, --card) instead of the original's
// hardcoded zinc/black-and-white palette. The live NumberFlow readout was
// originally an absolutely-positioned overlay above the thumb — dropped in
// favor of a plain trailing number at the end of the row (see App.tsx's
// ControlPanel), which sidesteps clipping/overlap at panel edges entirely.
export default function Slider({ value, className, ...props }: RadixSlider.SliderProps) {
  return (
    <RadixSlider.Root
      {...props}
      value={value}
      className={clsx(className, 'relative flex h-5 w-full touch-none select-none items-center')}
    >
      <RadixSlider.Track className="relative h-[3px] grow rounded-full bg-border">
        <RadixSlider.Range className="absolute h-full rounded-full bg-accent transition-[width] duration-150 ease-out" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        className="block size-3.5 rounded-full border border-accent bg-card shadow-sm transition-[left] duration-150 ease-out dark:border-[#912f40] dark:bg-accent-hover"
        aria-label={props['aria-label']}
      />
    </RadixSlider.Root>
  )
}

export { Slider }
