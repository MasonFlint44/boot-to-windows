// SPDX-License-Identifier: GPL-2.0-or-later
import js from '@eslint/js';
import globals from 'globals';

// GJS provides these at runtime (print/printerr/ARGV in scripts; log/logError
// and the shell's `global` inside GNOME Shell).
const gjsGlobals = {
    ARGV: 'readonly', print: 'readonly', printerr: 'readonly',
    log: 'readonly', logError: 'readonly', global: 'readonly',
    console: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
};

export default [
    {ignores: ['node_modules/', 'build/', 'tests/integration/out/']},
    js.configs.recommended,
    {
        files: ['**/*.js', 'extension/helper/boot-to-windows-helper'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
            'no-await-in-loop': 'error',
            'prefer-const': 'error',
            'eqeqeq': 'error',
            'no-var': 'error',
        },
    },
    {
        files: ['eslint.config.js'],
        languageOptions: {globals: globals.node},
    },
];
