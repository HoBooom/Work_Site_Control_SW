import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src/contracts/*.gen.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // 사이트·셀 이름으로 분기하지 않는다(spec DY-02). 이름은 site-config에서만 온다.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^(ship-block|factory|spider-\\d+|weld-booth-\\d+)$/]",
          message: '사이트·셀 이름을 코드에 쓰지 않는다. site-config에서 읽는다.',
        },
      ],
    },
  },
  {
    // 씬은 site-config와 store만 읽는다(spec 3절). 랩·MQTT를 알면 나중에 bus로 바꿀 때 씬이 바뀐다.
    files: ['src/scene/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../lab/*', '../../lab/*', '../bus/mqtt*', 'mqtt'], message: '씬은 랩·MQTT를 import하지 않는다' }] },
      ],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
