import test from 'node:test';
import assert from 'node:assert/strict';

import { ELRS } from '../js/elrs.js';

test('connect emits connected as soon as the serial port opens', async () => {
    const originalNavigator = globalThis.navigator;
    const port = {
        readable: {
            getReader() {
                return {
                    async read() {
                        return { done: true };
                    },
                    releaseLock() {},
                    async cancel() {}
                };
            }
        },
        writable: {
            getWriter() {
                return {
                    async write() {},
                    releaseLock() {}
                };
            }
        },
        async open() {},
        async close() {}
    };

    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            serial: {
                async requestPort() {
                    return port;
                }
            }
        }
    });

    try {
        const elrs = new ELRS();
        let connectedCount = 0;
        let readyCount = 0;

        elrs.on('connected', () => {
            connectedCount += 1;
        });
        elrs.on('ready', () => {
            readyCount += 1;
        });

        await elrs.connect();
        assert.equal(connectedCount, 1);
        assert.equal(readyCount, 0);

        elrs.markHandshakeReady();
        assert.equal(connectedCount, 1);
        assert.equal(readyCount, 1);

        await elrs.disconnect();
    } finally {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: originalNavigator
        });
    }
});
