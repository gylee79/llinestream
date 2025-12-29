
'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

type UseDotButtonType = {
  selectedIndex: number;
  scrollSnaps: number[];
  onDotButtonClick: (index: number) => void;
};

export const useDotButton = (
  emblaApi: any,
  onButtonClick?: (emblaApi: any) => void
): UseDotButtonType => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([]);

  const onDotButtonClick = React.useCallback(
    (index: number) => {
      if (!emblaApi) return;
      emblaApi.scrollTo(index);
      if (onButtonClick) onButtonClick(emblaApi);
    },
    [emblaApi, onButtonClick]
  );

  const onInit = React.useCallback((emblaApi: any) => {
    setScrollSnaps(emblaApi.scrollSnapList());
  }, []);

  const onSelect = React.useCallback((emblaApi: any) => {
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, []);

  React.useEffect(() => {
    if (!emblaApi) return;
    onInit(emblaApi);
    onSelect(emblaApi);
    emblaApi.on('reInit', onInit);
    emblaApi.on('reInit', onSelect);
    emblaApi.on('select', onSelect);
  }, [emblaApi, onInit, onSelect]);

  return { selectedIndex, scrollSnaps, onDotButtonClick };
};

type DotButtonProps = React.ComponentPropsWithRef<'button'> & {
    selected: boolean;
}

export const DotButton = React.forwardRef<HTMLButtonElement, DotButtonProps>((props, ref) => {
    const { selected, className, ...restProps } = props;
    return (
        <Button
            ref={ref}
            variant="ghost"
            size="icon"
            className={cn('h-3 w-3 rounded-full p-0', {
                'bg-primary': selected,
                'bg-muted-foreground/50': !selected,
            }, className)}
            {...restProps}
        />
    )
})

DotButton.displayName = "DotButton"

