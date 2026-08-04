import tseslint from 'typescript-eslint';

/**
 * Lint config exists for one reason: to hold the fairness boundary (Q114).
 *
 * This is not a style setup and deliberately does not try to be one. The
 * project already has `tsc --build` in strict mode and a large test suite; a
 * stylistic ruleset would add noise without adding safety. The rule below adds
 * safety that nothing else can, because it constrains what a file is *allowed
 * to know*, which is not a property a type checker or a test of behaviour can
 * express.
 *
 * `packages/server/src/director/context.ts` builds everything the LLM director
 * is ever shown. If it can reach the world, someone will eventually reach the
 * world — not maliciously, but because handing the model a little more context
 * is the obvious way to make it smarter, and the resulting enemy is
 * indistinguishable from a brilliant one right up until you notice the game
 * stopped being fair. DESIGN.md Step 10 names this as the trap.
 *
 * Backed up by `director/boundary.test.ts`, which reads the same file's source
 * and cannot be waived with an inline disable comment.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-types/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: 'module', ecmaVersion: 'latest' },
    },
  },
  {
    files: ['packages/server/src/director/context.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Anything that is not exactly ./perception.js.
              regex: '^(?!\\./perception\\.js$).*',
              message:
                'context.ts builds the director prompt and may import ONLY ./perception.js. ' +
                'Anything else is a route to the true world state, and an LLM given real ' +
                'player positions is omniscient rather than intelligent — a failure no ' +
                'amount of playtesting can detect. See DESIGN.md Q114 and Step 10.',
            },
          ],
        },
      ],
    },
  },
);
