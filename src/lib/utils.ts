import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
  }).format(price);
}

/**
 * Sanitizes data by deep copying it through JSON stringification and parsing.
 * This process removes any non-plain objects, such as class instances or Firestore Timestamps,
 * making the data safe to pass to Next.js Server Actions.
 * @param data The data to sanitize.
 * @returns A sanitized, plain JavaScript object.
 */
export function sanitize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
