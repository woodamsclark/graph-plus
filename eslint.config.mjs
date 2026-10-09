import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  { ignores: ['main.js', 'releases/**', 'node_modules/**', 'tests/**', 'examples/**', 'scripts/**'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts', 'packages/graph-engine-client/src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      'obsidianmd/rule-custom-message': 'warn',
    },
  },
];
