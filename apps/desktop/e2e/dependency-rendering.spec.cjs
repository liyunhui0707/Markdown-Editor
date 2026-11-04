const { test, expect } = require('@playwright/test');
const { createSession } = require('./session.cjs');

test('updated math and Mermaid bundles render in Electron with untrusted input restricted', async ({}, info) => {
  const session = await createSession(info);
  try {
    const running = await session.launch('edit');
    const result = await running.page.evaluate(async () => {
      const math = window.katex.renderToString(String.raw`\frac{1}{2}+x^2`, { displayMode: true, trust: false });
      const inherited = window.katex.renderToString(String.raw`\href{https://example.invalid/synthetic}{x}`,
        Object.assign(Object.create({ trust: true }), { strict: 'ignore' }));
      const mount = document.createElement('div'); mount.innerHTML = math; document.body.append(mount);
      const fraction = mount.querySelector('.katex-mfrac');
      const measured = { fraction: !!fraction, height: fraction?.getBoundingClientRect().height,
        font: fraction ? getComputedStyle(fraction).fontFamily : '' };
      mount.remove();
      const { svg } = await window.mermaid.render('dependency-security-diagram',
        'flowchart LR\n A["<img src=x onerror=window.syntheticUnsafe=true>"] --> B["$$x^2$$"]');
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const unsafeAttributes = [...parsed.querySelectorAll('*')].flatMap(el => [...el.attributes])
        .filter(a => /^on/i.test(a.name) || /^javascript:/i.test(a.value)).length;
      return { version: window.katex.version, math, inherited, measured, svg: svg.includes('<svg'),
        unsafeAttributes, scripts: parsed.querySelectorAll('script').length,
        executed: window.syntheticUnsafe === true };
    });
    expect(result.version).toBe(require('katex/package.json').version);
    expect(result.math).toContain('<mfrac>'); expect(result.math).toContain('<msup>');
    expect(result.measured.fraction).toBe(true); expect(result.measured.height).toBeGreaterThan(0);
    expect(result.measured.font).toContain('KaTeX');
    expect(result.inherited).not.toContain('href=');
    expect(result.svg).toBe(true); expect(result.unsafeAttributes).toBe(0);
    expect(result.scripts).toBe(0); expect(result.executed).toBe(false);
    await info.attach('dependency-rendering', { body: JSON.stringify(result), contentType: 'application/json' });
    await running.close();
  } finally { await session.finish(); }
});
