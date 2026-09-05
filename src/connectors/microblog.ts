import { decideMatch, type Candidate } from './matching.js';
import {
  ConnectorOperationError,
  type Credential,
  type DocumentMeta,
  type HttpTransport,
  type Match,
  type OutboundEvent,
  type ValidateResult,
} from './types.js';

const BASE_URL = 'https://micro.blog';
const RELEVANT = ['reading', 'finished', 'to-read', 'loans', 'holds'] as const;
type ShelfType = (typeof RELEVANT)[number];

interface ShelfDefinition {
  id: string;
  type: ShelfType;
}

interface ShelfBook extends Candidate {
  externalId: string;
  title: string;
  author: string;
  memberships: Set<ShelfType>;
}

function tokenOf(cred: Credential): string {
  const token = cred.token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new ConnectorOperationError('missing Micro.blog token', false);
  }
  return token.trim();
}

function destination(ev?: OutboundEvent): 'reading' | 'finished' {
  return ev?.kind === 'finished' || (ev?.percentage ?? 0) >= 0.98
    ? 'finished'
    : 'reading';
}

function operationError(status: number): ConnectorOperationError | null {
  if (status === 401 || status === 403) {
    return new ConnectorOperationError('invalid token', false, true);
  }
  if (status === 429 || status >= 500) {
    return new ConnectorOperationError(`Micro.blog request failed (${status})`, true);
  }
  if (status >= 400) {
    return new ConnectorOperationError(`Micro.blog request failed (${status})`, false);
  }
  return null;
}

async function request(
  http: HttpTransport,
  token: string,
  path: string,
  init: { method: string; body?: string }
): Promise<unknown> {
  let response;
  try {
    response = await http(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
  } catch (error) {
    if (error instanceof ConnectorOperationError) throw error;
    throw new ConnectorOperationError('Micro.blog request failed', true);
  }
  const failure = operationError(response.status);
  if (failure) throw failure;
  try {
    return await response.json();
  } catch {
    throw new ConnectorOperationError('Micro.blog returned malformed JSON', true);
  }
}

function isShelfType(value: unknown): value is ShelfType {
  return typeof value === 'string' && (RELEVANT as readonly string[]).includes(value);
}

function itemsOf(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new ConnectorOperationError('Micro.blog returned an invalid shelf feed', true);
  }
  return (payload as { items: unknown[] }).items;
}

async function loadShelves(cred: Credential, http: HttpTransport): Promise<ShelfDefinition[]> {
  const payload = await request(http, tokenOf(cred), '/books/bookshelves', { method: 'GET' });
  return itemsOf(payload).flatMap((item): ShelfDefinition[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as { id?: unknown; _microblog?: { type?: unknown } };
    if (raw.id == null || !isShelfType(raw._microblog?.type)) return [];
    const id = String(raw.id).trim();
    return id ? [{ id, type: raw._microblog.type }] : [];
  });
}

export function extractBooks(payload: unknown, membership: ShelfType): ShelfBook[] {
  return itemsOf(payload).flatMap((item): ShelfBook[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as { id?: unknown; title?: unknown; authors?: unknown };
    if (raw.id == null || typeof raw.title !== 'string' || !raw.title.trim()) return [];
    const externalId = String(raw.id).trim();
    if (!externalId) return [];
    const authors = Array.isArray(raw.authors) ? raw.authors : [];
    const author = authors
      .flatMap((value) => value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
        ? [(value as { name: string }).name.trim()]
        : [])
      .filter(Boolean)
      .join(', ');
    return [{ externalId, title: raw.title, author, memberships: new Set([membership]) }];
  });
}

async function loadBooks(
  cred: Credential,
  shelf: ShelfDefinition,
  http: HttpTransport
): Promise<ShelfBook[]> {
  const payload = await request(http, tokenOf(cred), `/books/bookshelves/${encodeURIComponent(shelf.id)}`, {
    method: 'GET',
  });
  return extractBooks(payload, shelf.type);
}

async function loadInventory(cred: Credential, http: HttpTransport): Promise<ShelfBook[]> {
  const shelves = await loadShelves(cred, http);
  const byId = new Map<string, ShelfBook>();
  for (const shelf of shelves) {
    for (const book of await loadBooks(cred, shelf, http)) {
      const existing = byId.get(book.externalId);
      if (existing) existing.memberships.add(shelf.type);
      else byId.set(book.externalId, book);
    }
  }
  return [...byId.values()];
}

async function validateCredential(cred: Credential, http: HttpTransport): Promise<ValidateResult> {
  try {
    await loadShelves(cred, http);
    return { ok: true };
  } catch (error) {
    if (error instanceof ConnectorOperationError && error.needsReauth) {
      return { ok: false, error: 'invalid token' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Micro.blog request failed' };
  }
}

async function matchBook(
  cred: Credential,
  doc: DocumentMeta,
  http: HttpTransport,
  ev?: OutboundEvent
): Promise<Match | null> {
  const title = doc.title?.trim();
  const author = doc.author?.trim();
  if (!title || !author) return null;
  const inventory = await loadInventory(cred, http);
  const target = destination(ev);
  const opposite = target === 'reading' ? 'finished' : 'reading';
  const order: ShelfType[] = [target, opposite, 'to-read', 'loans', 'holds'];
  const candidates: ShelfBook[] = [];
  for (const shelfType of order) {
    for (const book of inventory) {
      if (book.memberships.has(shelfType) && !candidates.some((candidate) => candidate.externalId === book.externalId)) {
        candidates.push(book);
      }
    }
  }
  const decision = decideMatch(title, author, candidates);
  if (!decision.accepted || !decision.best) return null;
  return {
    externalId: decision.best.externalId,
    confidence: decision.best.score,
    title: decision.best.title,
    author: decision.best.author ?? null,
  };
}

function responseId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as { id?: unknown; book_id?: unknown; item?: { id?: unknown }; book?: { id?: unknown } };
  const id = raw.id ?? raw.book_id ?? raw.item?.id ?? raw.book?.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const value = String(id).trim();
  return value || null;
}

async function createBook(
  cred: Credential,
  doc: DocumentMeta,
  ev: OutboundEvent,
  http: HttpTransport
): Promise<Match | null> {
  const title = doc.title?.trim();
  const author = doc.author?.trim();
  if (!title || !author) return null;
  const target = destination(ev);
  const shelf = (await loadShelves(cred, http)).find((item) => item.type === target);
  if (!shelf) {
    throw new ConnectorOperationError(`Micro.blog ${target} shelf is unavailable`, false);
  }
  const payload = await request(http, tokenOf(cred), '/books', {
    method: 'POST',
    body: new URLSearchParams({ title, author, bookshelf_id: shelf.id }).toString(),
  });
  const id = responseId(payload);
  if (id) return { externalId: id, confidence: 1, title, author };
  const recovered = decideMatch(title, author, await loadBooks(cred, shelf, http));
  if (recovered.accepted && recovered.best) {
    return {
      externalId: recovered.best.externalId,
      confidence: recovered.best.score,
      title: recovered.best.title,
      author: recovered.best.author ?? null,
    };
  }
  throw new ConnectorOperationError('Micro.blog created the book but did not return or expose its id', false);
}

export const _microblog = {
  validateCredential,
  extractBooks,
  matchBook,
  createBook,
};
