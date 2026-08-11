// Extends the standard Conventional Commits type list with `debug`, the one
// non-standard type already in this repo's history (see e.g. f0e742b). Every
// other type below is one `@commitlint/config-conventional` already ships;
// listing them out here is what makes `debug` additive rather than a swap.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'debug',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
  },
};
