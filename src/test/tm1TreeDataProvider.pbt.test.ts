import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Tm1TreeDataProvider } from '../providers/tm1TreeDataProvider';
import { TreeItemCollapsibleState } from './__mocks__/vscode';

// Mock apiRequest
vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: (res: { statusCode: number; body: string }, context?: string) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const prefix = context ? `${context}: ` : '';
      let detail = res.body.substring(0, 300);
      try {
        const parsed = JSON.parse(res.body);
        const msg = parsed?.error?.message;
        detail = (typeof msg === 'object' ? msg?.value : msg) ?? detail;
      } catch { /* keep raw */ }
      throw new Error(`${prefix}HTTP ${res.statusCode}: ${detail}`);
    }
  },
}));

vi.mock('../tm1Rest/sandboxApi', async () => {
  const actual = await vi.importActual<typeof import('../tm1Rest/sandboxApi')>('../tm1Rest/sandboxApi');
  return { ...actual, isSandboxEnabled: vi.fn().mockResolvedValue(true) };
});

import { apiRequest } from '../tm1Rest/client';
const mockApiRequest = vi.mocked(apiRequest);

const TEST_SERVER = {
  id: 'test-srv', name: 'Test', serverUrl: 'http://localhost:8010',
  username: 'admin', rejectUnauthorized: false, authType: 'Basic' as const,
};
const TEST_CONFIG = {
  serverUrl: 'http://localhost:8010', username: 'admin', password: '',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

/** Helper: create a connected single-server provider. */
function makeProvider() {
  return new Tm1TreeDataProvider(
    () => [TEST_SERVER],
    (id) => id === TEST_SERVER.id,
    (id) => id === TEST_SERVER.id ? TEST_CONFIG : undefined,
  );
}

/**
 * Helper: create a provider with active server, get server root, then find a category by label.
 */
async function getCategoryNode(provider: Tm1TreeDataProvider, categoryLabel: string) {
  const [serverRoot] = await provider.getChildren(undefined);
  const categories = await provider.getChildren(serverRoot);
  return categories.find((c) => c.label === categoryLabel)!;
}

describe('Property-Based Tests: Category Data Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: tm1-object-explorer, Property 1: API response is mapped completely onto tree nodes
  describe('Property 1: API response is mapped completely onto tree nodes', () => {
    // **Validates: Requirements 2.2, 2.5, 2.8, 2.9, 2.11**

    it('Cubes: exactly one child node per name, labels match, no duplicates, no missing', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')), { minLength: 0, maxLength: 50 }),
          async (names) => {
            vi.clearAllMocks();
            const uniqueNames = [...new Set(names)];
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: uniqueNames.map((n) => ({ Name: n })) }),
            });

            const provider = makeProvider();
            const cubesCat = await getCategoryNode(provider, 'Cubes');
            const children = await provider.getChildren(cubesCat);

            expect(children).toHaveLength(uniqueNames.length);
            const labels = children.map((c) => c.label);
            expect(labels).toEqual(uniqueNames);
            // No duplicates
            expect(new Set(labels).size).toBe(labels.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Dimensions: exactly one child node per name, labels match', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')), { minLength: 0, maxLength: 50 }),
          async (names) => {
            vi.clearAllMocks();
            const uniqueNames = [...new Set(names)];
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: uniqueNames.map((n) => ({ Name: n })) }),
            });

            const provider = makeProvider();
            const dimCat = await getCategoryNode(provider, 'Dimensions');
            const children = await provider.getChildren(dimCat);

            expect(children).toHaveLength(uniqueNames.length);
            const labels = children.map((c) => c.label);
            expect(labels).toEqual(uniqueNames);
            expect(new Set(labels).size).toBe(labels.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Processes: exactly one child node per name (alphabetically sorted) when no group markers are present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.string({ minLength: 1 }).filter(n => !n.startsWith('}') && !n.endsWith('#####')),
            { minLength: 0, maxLength: 50 },
          ),
          async (names) => {
            vi.clearAllMocks();
            const uniqueNames = [...new Set(names)];
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: uniqueNames.map((n) => ({ Name: n })) }),
            });

            const provider = makeProvider();
            const procCat = await getCategoryNode(provider, 'Processes');
            const children = await provider.getChildren(procCat);

            expect(children).toHaveLength(uniqueNames.length);
            const labels = children.map((c) => c.label);
            const expected = [...uniqueNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
            expect(labels).toEqual(expected);
            expect(new Set(labels).size).toBe(labels.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Chores: exactly one child node per name with active status preserved', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({ Name: fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')), Active: fc.boolean() }),
            { minLength: 0, maxLength: 50 },
          ),
          async (chores) => {
            vi.clearAllMocks();
            // Deduplicate by Name
            const seen = new Set<string>();
            const uniqueChores = chores.filter((c) => {
              if (seen.has(c.Name)) { return false; }
              seen.add(c.Name);
              return true;
            });

            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: uniqueChores }),
            });

            const provider = makeProvider();
            const choreCat = await getCategoryNode(provider, 'Chores');
            const children = await provider.getChildren(choreCat);

            expect(children).toHaveLength(uniqueChores.length);
            for (let i = 0; i < uniqueChores.length; i++) {
              expect(children[i].label).toBe(uniqueChores[i].Name);
              expect(children[i].meta.active).toBe(uniqueChores[i].Active);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Threads: exactly one child node per active (non-Idle) thread, capped at 5', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate threads with an active State so none get filtered; cap at 5 to stay within slice limit
          fc.array(
            fc.record({
              ID: fc.nat({ max: 10000 }),
              State: fc.constantFrom('Running', 'Waiting', 'Executing'),
            }),
            { minLength: 0, maxLength: 5 },
          ),
          async (threads) => {
            vi.clearAllMocks();
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: threads }),
            });

            const provider = makeProvider();
            const threadCat = await getCategoryNode(provider, 'Threads');
            const children = await provider.getChildren(threadCat);

            expect(children).toHaveLength(threads.length);
            for (let i = 0; i < threads.length; i++) {
              expect(children[i].label).toBe(`Thread ${threads[i].ID}`);
              expect(children[i].meta.threadId).toBe(threads[i].ID);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: tm1-object-explorer, Property 3: search filter returns the correct subset
  describe('Property 3: search filter returns the correct subset', () => {
    // **Validates: Requirements 7.2**

    it('filter returns exactly the subset where name includes search term (case-insensitive)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')), { minLength: 0, maxLength: 50 }),
          fc.string(),
          async (names, searchTerm) => {
            vi.clearAllMocks();
            const uniqueNames = [...new Set(names)];
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: uniqueNames.map((n) => ({ Name: n })) }),
            });

            const provider = makeProvider();
            provider.setFilter(searchTerm);
            const cubesCat = await getCategoryNode(provider, 'Cubes');
            const children = await provider.getChildren(cubesCat);

            const expected = searchTerm === ''
              ? uniqueNames
              : uniqueNames.filter((n) => n.toLowerCase().includes(searchTerm.toLowerCase()));

            expect(children).toHaveLength(expected.length);
            const labels = children.map((c) => c.label);
            expect(labels).toEqual(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty search term returns all items', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')), { minLength: 0, maxLength: 50 }),
          async (names) => {
            vi.clearAllMocks();
            const uniqueNames = [...new Set(names)];
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: uniqueNames.map((n) => ({ Name: n })) }),
            });

            const provider = makeProvider();
            provider.setFilter('');
            const cubesCat = await getCategoryNode(provider, 'Cubes');
            const children = await provider.getChildren(cubesCat);

            expect(children).toHaveLength(uniqueNames.length);
            const labels = children.map((c) => c.label);
            expect(labels).toEqual(uniqueNames);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: tm1-object-explorer, Property 7: thread count in the category description
  describe('Property 7: thread count in the category description', () => {
    // **Validates: Requirements 2.12**

    it('category description equals "${count} Threads"', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ ID: fc.nat({ max: 10000 }) }), { minLength: 0, maxLength: 100 }),
          async (threads) => {
            vi.clearAllMocks();
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: threads }),
            });

            const provider = makeProvider();
            const threadCat = await getCategoryNode(provider, 'Threads');
            await provider.getChildren(threadCat);

            expect(threadCat.description).toBe(`${threads.length} Threads`);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: tm1-object-explorer, Property 2: object subcategories are structurally correct
  describe('Property 2: object subcategories are structurally correct', () => {
    // **Validates: Requirements 2.3, 2.6**

    it('Cube nodes return exactly ["Rules", "Dimensions", "Views", "Private Views"] sub-categories', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')),
          async (cubeName) => {
            vi.clearAllMocks();
            // Mock the Cubes category API to return one cube with the generated name
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: [{ Name: cubeName }] }),
            });

            const provider = makeProvider();
            const cubesCat = await getCategoryNode(provider, 'Cubes');
            const cubes = await provider.getChildren(cubesCat);
            expect(cubes).toHaveLength(1);

            // Get children of the cube node
            const subCategories = await provider.getChildren(cubes[0]);

            // Verify exactly 4 children: Rules (cubeRule) + Dimensions + Views + Private Views (cubeSubCategory)
            expect(subCategories).toHaveLength(4);
            expect(subCategories.map((sc) => sc.label)).toEqual(['Rules', 'Dimensions', 'Views', 'Private Views']);

            // Rules node is cubeRule type
            expect(subCategories[0].nodeType).toBe('cubeRule');
            expect(subCategories[0].meta.cubeName).toBe(cubeName);

            // Dimensions and Views are cubeSubCategory
            for (const sc of subCategories.slice(1)) {
              expect(sc.nodeType).toBe('cubeSubCategory');
              expect(sc.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
              expect(sc.meta.cubeName).toBe(cubeName);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Dimension nodes return exactly ["Hierarchies", "Attributes", "Subsets"] sub-categories', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')),
          async (dimName) => {
            vi.clearAllMocks();
            // Mock the Dimensions category API to return one dimension with the generated name
            mockApiRequest.mockResolvedValueOnce({
              statusCode: 200,
              body: JSON.stringify({ value: [{ Name: dimName }] }),
            });

            const provider = makeProvider();
            const dimCat = await getCategoryNode(provider, 'Dimensions');
            const dimensions = await provider.getChildren(dimCat);
            expect(dimensions).toHaveLength(1);

            // Get children of the dimension node
            const subCategories = await provider.getChildren(dimensions[0]);

            // Verify exactly 3 sub-categories in fixed order
            expect(subCategories).toHaveLength(3);
            expect(subCategories.map((sc) => sc.label)).toEqual(['Hierarchies', 'Attributes', 'Subsets']);

            // Verify all are dimSubCategory type
            for (const sc of subCategories) {
              expect(sc.nodeType).toBe('dimSubCategory');
              expect(sc.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
              expect(sc.meta.dimName).toBe(dimName);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

// Feature: tm1-object-explorer, Property 4: error nodes contain HTTP status and error message
describe('Property 4: error nodes contain HTTP status and error message', () => {
  // **Validates: Requirements 3.4, 10.2**

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('error node label contains HTTP status code and error message for non-2xx responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 400, max: 599 }),
        fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')),
        async (statusCode, errorMessage) => {
          vi.clearAllMocks();
          mockApiRequest.mockResolvedValueOnce({
            statusCode,
            body: JSON.stringify({ error: { message: errorMessage } }),
          });

          const provider = makeProvider();
          const cubesCat = await getCategoryNode(provider, 'Cubes');
          const children = await provider.getChildren(cubesCat);

          expect(children).toHaveLength(1);
          expect(children[0].nodeType).toBe('error');
          // Label must contain the HTTP status code
          expect(children[0].label).toContain(`${statusCode}`);
          // Label must contain the error message
          expect(children[0].label).toContain(errorMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('error node label contains "Timeout" for timeout errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(n => !n.startsWith('}')),
        async (suffix) => {
          vi.clearAllMocks();
          // Simulate a timeout error — message must include 'Timeout'
          mockApiRequest.mockRejectedValueOnce(new Error(`Timeout${suffix}`));

          const provider = makeProvider();
          const cubesCat = await getCategoryNode(provider, 'Cubes');
          const children = await provider.getChildren(cubesCat);

          expect(children).toHaveLength(1);
          expect(children[0].nodeType).toBe('error');
          expect(children[0].label).toContain('Timeout');
        },
      ),
      { numRuns: 100 },
    );
  });
});
