// Links between the pages resolve against the site's real base address. Moving between pages replaces the
// current history entry, so the browser's back button returns to where you were, not back into the builder.
export function fixLinks() {
  const base = import.meta.env.BASE_URL;
  const target: Record<string, string> = { home: base, play: `${base}play/`, build: `${base}build/` };
  document.querySelectorAll<HTMLAnchorElement>('a[data-go]').forEach((a) => {
    const url = target[a.dataset.go ?? 'home'];
    a.href = url;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      location.replace(url);
    });
  });
}
