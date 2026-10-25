// SPDX-License-Identifier: GPL-2.0-or-later
//
// A deliberately tiny test runner for GJS: register with test(), run with
// run(). No dependencies, so the unit suite runs anywhere gjs does.

const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export class AssertionError extends Error {}

function show(v) {
    if (v instanceof Map)
        return `Map(${JSON.stringify([...v])})`;
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

function deepEqual(a, b) {
    if (Object.is(a, b))
        return true;
    if (a instanceof Map && b instanceof Map)
        return deepEqual([...a], [...b]);
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
}

export const assert = {
    equal(actual, expected, msg = '') {
        if (!deepEqual(actual, expected))
            throw new AssertionError(`${msg}\n  expected: ${show(expected)}\n  actual:   ${show(actual)}`);
    },
    ok(value, msg = 'expected truthy') {
        if (!value)
            throw new AssertionError(msg);
    },
    throws(fn, pattern, msg = '') {
        try {
            fn();
        } catch (e) {
            if (pattern && !pattern.test(String(e?.message ?? e)))
                throw new AssertionError(`${msg} threw ${show(e?.message)}, expected ${pattern}`);
            return e;
        }
        throw new AssertionError(`${msg} expected to throw`);
    },
    async rejects(promise, pattern, msg = '') {
        try {
            await promise;
        } catch (e) {
            if (pattern && !pattern.test(String(e?.message ?? e)))
                throw new AssertionError(`${msg} rejected with ${show(e?.message)}, expected ${pattern}`);
            return e;
        }
        throw new AssertionError(`${msg} expected to reject`);
    },
};

/** Runs every registered test; resolves to the number of failures. */
export async function run({filter = null} = {}) {
    let failed = 0, passed = 0;
    for (const {name, fn} of tests) {
        if (filter && !name.includes(filter))
            continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            await fn();
            passed++;
            print(`ok   ${name}`);
        } catch (e) {
            failed++;
            print(`FAIL ${name}\n     ${String(e?.message ?? e).split('\n').join('\n     ')}`);
            if (!(e instanceof AssertionError) && e?.stack)
                print(`     ${e.stack.split('\n').join('\n     ')}`);
        }
    }
    print(`\n${passed} passed, ${failed} failed`);
    return failed;
}
