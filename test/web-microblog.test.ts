import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.js';

describe('Micro.blog web setup', () => {
  it('lists Micro.blog on the public services page', async () => {
    const { app } = makeTestApp();
    const html = await (await app.request('/')).text();
    expect(html).toContain('Micro.blog');
    expect(html).toContain('Currently reading');
    expect(html).toContain('Finished reading');
    expect(html).toContain('onerror="this.style.display=\'none\'"');
  });

  it('renders where to create the pasted app token', async () => {
    const { app } = makeTestApp();
    const signup = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: `web-${Date.now()}` }),
    });
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];
    const html = await (await app.request('/link/microblog', { headers: { cookie } })).text();

    const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const elements = new Map<string, { textContent: string; innerHTML: string; hidden: boolean; disabled: boolean; onclick?: () => void }>();
    const getElement = (id: string) => {
      let element = elements.get(id);
      if (!element) {
        element = { textContent: '', innerHTML: '', hidden: false, disabled: false };
        elements.set(id, element);
      }
      return element;
    };

    runInNewContext(script!, {
      location: { pathname: '/link/microblog' },
      document: { getElementById: getElement },
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ connectors: [{ id: 'microblog', name: 'Micro.blog', credential_kind: 'token' }] }),
      }),
      setTimeout: () => 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getElement('desc').textContent).toBe(
      'Paste your Micro.blog app token from Account → Edit Apps. Keeps your Currently reading and Finished reading bookshelves in sync.',
    );
  });
});
