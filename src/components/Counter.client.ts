import type { CounterProps } from './Counter.island';

interface IslandContext {
  props: CounterProps;
  url: string;
}

/** Browser-only DOM controller. This bundle contains no React runtime. */
export default function mountCounter(root: HTMLElement, { props }: IslandContext) {
  const output = root.querySelector<HTMLOutputElement>('[data-count]');
  const decrement = root.querySelector<HTMLButtonElement>('[data-decrement]');
  const increment = root.querySelector<HTMLButtonElement>('[data-increment]');
  const status = root.querySelector<HTMLElement>('[data-status]');
  const step = Number(props.step ?? 1);
  let count = Number(output?.textContent ?? props.initialCount ?? 0);

  if (!output || !decrement || !increment) {
    throw new Error('Counter island markup is incomplete.');
  }

  const update = (next: number) => {
    count = next;
    output.textContent = String(count);
  };
  decrement.addEventListener('click', () => update(count - step));
  increment.addEventListener('click', () => update(count + step));
  if (status) status.textContent = 'Controller loaded. No React was sent to the browser.';
}
