'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import type { CarouselApi } from '@/components/ui/carousel';

type UseDotButtonType = {
  selectedIndex: number;
  scrollSnaps: number[];
  onDotButtonClick: (index: number) => void;
};

export const useDotButton = (
  api: CarouselApi | undefined,
): UseDotButtonType => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([]);

  const onDotButtonClick = React.useCallback(
    (index: number) => {
      if (!api) return;
      api.scrollTo(index);
    },
    [api]
  );

  const onInit = React.useCallback((api: CarouselApi) => {
    if (!api) return;
    setScrollSnaps(api.scrollSnapList());
  }, []);

  const onSelect = React.useCallback((api: CarouselApi) => {
    if (!api) return;
    setSelectedIndex(api.selectedScrollSnap());
  }, []);

  React.useEffect(() => {
    if (!api) return;
    onInit(api);
    onSelect(api);
    api.on('reInit', onInit);
    api.on('select', onSelect);
  }, [api, onInit, onSelect]);

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
            className={cn('h-3 w-3 rounded-full p-0 transition-colors', {
                'bg-primary': selected,
                'bg-muted-foreground/50 hover:bg-muted-foreground': !selected,
            }, className)}
            {...restProps}
        />
    )
})

DotButton.displayName = "DotButton"
