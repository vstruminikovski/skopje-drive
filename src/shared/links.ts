// Links between the pages resolve against the site's real base address (works at any depth and without a trailing slash).
export function fixLinks() {
  const base = import.meta.env.BASE_URL;
  const target: Record<string, string> = { home: base, play: `${base}play/`, build: `${base}build/` };
  document.querySelectorAll<HTMLAnchorElement>('a[data-go]').forEach((a) => {
    a.href = target[a.dataset.go ?? 'home'];
  });
}
