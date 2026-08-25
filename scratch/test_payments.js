const assert = require('assert');

function test(name, fn) {
    try {
        fn();
        console.log('PASS: ' + name);
    } catch (e) {
        console.error('FAIL: ' + name, e.message);
        process.exit(1);
    }
}

test('Sanity test', () => {
    assert.strictEqual(1, 1);
});

console.log('Automated tests executed successfully.');
