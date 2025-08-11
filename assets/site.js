// Include partials and mark active nav
document.addEventListener('DOMContentLoaded', async () => {
  // Inject header/footer partials
  const includeNodes = document.querySelectorAll('[data-include]');
  await Promise.all([...includeNodes].map(async (node) => {
    const url = node.getAttribute('data-include');
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      node.outerHTML = await res.text();
    } catch (e) {
      console.error('Include failed for', url, e);
    }
  }));

  // After include, set active nav and mobile toggle
  const nav = document.querySelector('.nav');
  if (nav) {
    const here = location.pathname.replace(/\/index\.html$/, '/');
    nav.querySelectorAll('a[data-nav]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && (href === here || (href !== '/' && here.startsWith(href)))) {
        a.classList.add('active');
      }
    });
    const btn = document.querySelector('.menu-button');
    if (btn) btn.addEventListener('click', ()=> nav.classList.toggle('open'));
  }
});
