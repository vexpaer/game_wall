export async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency 必须是正整数");
  }

  const results = new Array<U>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}
