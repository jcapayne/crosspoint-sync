import { describe, expect, it } from 'vitest';
import { _microblog } from '../src/connectors/microblog.js';
import { makeMicroblogTransport } from './microblog-helpers.js';

const CRED = { token: 'mb-token' };
const DOC = {
  document: 'd', title: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin', filename: null,
};
const EV = { kind: 'progress' as const, document: 'd', percentage: 0.4, timestamp: 1 };

describe('Micro.blog shelf lookup', () => {
  it('validates an app token against the bookshelves endpoint', async () => {
    const fake = makeMicroblogTransport();
    expect(await _microblog.validateCredential(CRED, fake.transport)).toEqual({ ok: true });
    expect(fake.calls[0]).toMatchObject({
      url: 'https://micro.blog/books/bookshelves', method: 'GET',
      headers: { authorization: 'Bearer mb-token' },
    });
  });

  it('rejects a missing token and an unauthorized token', async () => {
    const fake = makeMicroblogTransport();
    expect((await _microblog.validateCredential({}, fake.transport)).ok).toBe(false);
    fake.fail('GET', '/books/bookshelves', 401);
    expect(await _microblog.validateCredential(CRED, fake.transport)).toEqual({
      ok: false, error: 'invalid token',
    });
  });

  it('prefers destination, opposite, want, loans, then holds', async () => {
    const wanted = { id: '30', title: DOC.title!, author: DOC.author! };
    const loan = { ...wanted, id: '31' };
    const fake = makeMicroblogTransport({ shelves: { 'to-read': [wanted], loans: [loan] } });
    expect((await _microblog.matchBook(CRED, DOC, fake.transport, EV))?.externalId).toBe('30');
  });

  it('treats absent optional Libby shelves as empty', async () => {
    const wanted = { id: '32', title: DOC.title!, author: DOC.author! };
    const fake = makeMicroblogTransport({
      shelves: { 'to-read': [wanted] }, omitShelves: ['loans', 'holds'],
    });
    expect((await _microblog.matchBook(CRED, DOC, fake.transport, EV))?.externalId).toBe('32');
  });

  it('matches normalized title and author and collapses repeated ids', async () => {
    const book = { id: '40', title: 'The Left Hand of Darkness: A Novel', author: 'Le Guin, Ursula K.' };
    const fake = makeMicroblogTransport({ shelves: { loans: [book], holds: [book] } });
    const match = await _microblog.matchBook(CRED, DOC, fake.transport, EV);
    expect(match?.externalId).toBe('40');
  });

  it('joins multiple API author names for matching', () => {
    expect(_microblog.extractBooks({
      items: [{ id: 5, title: 'Good Omens', authors: [{ name: 'Neil Gaiman' }, { name: 'Terry Pratchett' }] }],
    }, 'reading')).toEqual([{
      externalId: '5', title: 'Good Omens', author: 'Neil Gaiman, Terry Pratchett',
      memberships: new Set(['reading']),
    }]);
  });

  it.each([
    [{ ...DOC, title: null }],
    [{ ...DOC, author: null }],
    [{ ...DOC, author: '   ' }],
  ])('does not auto-match incomplete metadata', async (doc) => {
    const fake = makeMicroblogTransport({ shelves: { reading: [{ id: '1', title: DOC.title!, author: DOC.author! }] } });
    expect(await _microblog.matchBook(CRED, doc, fake.transport, EV)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe('Micro.blog book creation', () => {
  it('creates directly on the event destination shelf', async () => {
    const fake = makeMicroblogTransport({ createResponse: { id: 90 } });
    const match = await _microblog.createBook(CRED, DOC, EV, fake.transport);
    expect(match?.externalId).toBe('90');
    const create = fake.calls.find((call) => call.url.endsWith('/books') && call.method === 'POST');
    expect(new URLSearchParams(create!.body!).get('bookshelf_id')).toBe('10');
    expect(new URLSearchParams(create!.body!).get('title')).toBe(DOC.title);
    expect(new URLSearchParams(create!.body!).get('author')).toBe(DOC.author);
  });

  it('recovers the new id from the destination shelf when the response omits it', async () => {
    const fake = makeMicroblogTransport({ createResponse: {} });
    expect((await _microblog.createBook(CRED, DOC, EV, fake.transport))?.externalId).toBeTruthy();
    expect(fake.calls.filter((call) => call.url.endsWith('/books/bookshelves/10'))).toHaveLength(1);
  });

  it('does not create with incomplete metadata', async () => {
    const fake = makeMicroblogTransport();
    expect(await _microblog.createBook(CRED, { ...DOC, author: null }, EV, fake.transport)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('fails permanently when creation cannot recover a real id', async () => {
    const fake = makeMicroblogTransport({ createResponse: {} });
    fake.shelves.set('reading', []);
    fake.disableCreateMutation();
    await expect(_microblog.createBook(CRED, DOC, EV, fake.transport)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('fails permanently when the destination shelf is absent', async () => {
    const fake = makeMicroblogTransport({ omitShelves: ['reading'] });
    await expect(_microblog.createBook(CRED, DOC, EV, fake.transport)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('treats a malformed successful shelf feed as retryable', async () => {
    const fake = makeMicroblogTransport();
    fake.fail('GET', '/books/bookshelves', 200, { unexpected: true });
    await expect(_microblog.createBook(CRED, DOC, EV, fake.transport)).rejects.toMatchObject({
      retryable: true,
    });
  });
});
