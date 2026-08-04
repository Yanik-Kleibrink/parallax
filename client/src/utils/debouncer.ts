/**
 * Debounce function to limit the rate at which a function can fire.
 * @param fn - The function to debounce.
 * @param delay - The delay in milliseconds to wait before invoking the function.
 * @returns A debounced version of the provided function.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}
