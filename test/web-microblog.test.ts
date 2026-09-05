import { describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.js';

describe('Micro.blog web setup', () => {
  it('lists Micro.blog on the public services page', async () => {
    const { app } = makeTestApp();
    const html = await (await app.request('/')).text();
    expect(html).toContain('Micro.blog');
    expect(html).toContain('Currently reading');
    expect(html).toContain('Finished reading');
  });

  it('explains where to create the pasted app token', async () => {
    const { app } = makeTestApp();
    const signup = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: `web-${Date.now()}` }),
    });
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];
    const html = await (await app.request('/link/microblog', { headers: { cookie } })).text();
    expect(html).toContain('Account');
    expect(html).toContain('Edit Apps');
    expect(html).toContain('Micro.blog app token');
  });
});
