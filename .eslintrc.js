module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es2021: true,
        node: true,
        jest: true
    },
    extends: [
        'eslint:recommended'
    ],
    parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module'
    },
    plugins: [
        'jest',
        'security'
    ],
    rules: {
        // Reglas de estilo
        'indent': ['error', 4],
        'linebreak-style': 'off', // Desactivar para compatibilidad con Windows
        'quotes': ['error', 'single'],
        'semi': ['error', 'always'],
        
        // Reglas de calidad
        'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
        'no-console': 'warn',
        'no-debugger': 'error',
        'no-alert': 'error',
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        
        // Reglas de seguridad
        'security/detect-object-injection': 'warn',
        'security/detect-non-literal-regexp': 'warn',
        'security/detect-unsafe-regex': 'error',
        'security/detect-buffer-noassert': 'error',
        'security/detect-child-process': 'warn',
        'security/detect-disable-mustache-escape': 'error',
        'security/detect-eval-with-expression': 'error',
        'security/detect-no-csrf-before-method-override': 'error',
        'security/detect-non-literal-fs-filename': 'warn',
        'security/detect-non-literal-require': 'warn',
        'security/detect-possible-timing-attacks': 'warn',
        'security/detect-pseudoRandomBytes': 'error',
        
        // Reglas de Jest
        'jest/no-disabled-tests': 'warn',
        'jest/no-focused-tests': 'error',
        'jest/no-identical-title': 'error',
        'jest/prefer-to-have-length': 'warn',
        'jest/valid-expect': 'error'
    },
    overrides: [
        {
            files: ['tests/**/*.js'],
            env: {
                jest: true
            },
            rules: {
                'no-console': 'off'
            }
        },
        {
            files: ['scripts/**/*.js'],
            rules: {
                'no-console': 'off',
                'security/detect-non-literal-fs-filename': 'off'
            }
        },
        {
            files: ['middleware/**/*.js'],
            rules: {
                'security/detect-object-injection': 'off'
            }
        },
        {
            files: ['server.js'],
            rules: {
                'no-console': 'off',
                'security/detect-object-injection': 'off'
            }
        }
    ]
};
