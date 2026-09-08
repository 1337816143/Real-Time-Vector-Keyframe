/** Observe application-owned text without observing our own translations. */
const ATTRIBUTES = ['title', 'aria-label', 'placeholder'];
const OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ATTRIBUTES,
};
const SKIP = 'script, style, textarea, [contenteditable="true"], [data-no-localize]';

export function observeUiLocalization(
  root: HTMLElement,
  translate: (value: string) => string,
  afterTranslate: () => void = () => undefined,
): () => void {
  // A Map deduplicates nodes and remembers whether newly mounted children need visiting.
  const pending = new Map<Node, boolean>();
  let frame: number | undefined;
  let disposed = false;

  const enqueue = (node: Node, subtree: boolean) => {
    if (node !== root && !root.contains(node)) return;
    pending.set(node, subtree || pending.get(node) === true);
  };

  const collect = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') enqueue(mutation.target, false);
      for (const node of mutation.addedNodes) enqueue(node, true);
    }
  };

  const schedule = () => {
    if (!disposed && frame === undefined && pending.size) frame = requestAnimationFrame(flush);
  };

  const observer = new MutationObserver((mutations) => {
    // Never mutate the DOM inside the observer's microtask callback.
    collect(mutations);
    schedule();
  });

  function flush() {
    frame = undefined;
    if (disposed) return;
    // Preserve external changes queued since the last callback, then suspend observation.
    collect(observer.takeRecords());
    observer.disconnect();
    const deadline = performance.now() + 6;
    let visited = 0;
    try {
      while (pending.size && visited < 400 && (visited === 0 || performance.now() < deadline)) {
        const [node, subtree] = pending.entries().next().value as [Node, boolean];
        pending.delete(node);
        visited += 1;
        if (node !== root && !root.contains(node)) continue;
        const element = node instanceof Element ? node : node.parentElement;
        if (!element || element.closest(SKIP)) continue;

        if (node.nodeType === Node.TEXT_NODE) {
          const value = node.nodeValue ?? '';
          const trimmed = value.trim();
          if (trimmed) {
            const next = translate(trimmed);
            if (next !== trimmed) {
              const start = value.indexOf(trimmed);
              node.nodeValue = value.slice(0, start) + next + value.slice(start + trimmed.length);
            }
          }
        } else if (node instanceof Element) {
          for (const name of ATTRIBUTES) {
            const value = node.getAttribute(name);
            if (!value) continue;
            const next = translate(value);
            if (next !== value) node.setAttribute(name, next);
          }
          if (subtree) for (const child of node.childNodes) enqueue(child, true);
        }
      }
      afterTranslate();
    } finally {
      // Self-authored text/attribute writes must never re-enter the observer.
      if (!disposed) {
        observer.observe(root, OPTIONS);
        schedule();
      }
    }
  }

  observer.observe(root, OPTIONS);
  enqueue(root, true);
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    pending.clear();
  };
}
