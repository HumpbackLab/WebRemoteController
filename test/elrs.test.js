import test from 'node:test';
import assert from 'node:assert/strict';

import { ELRS } from '../js/elrs.js';
import * as CRSF from '../js/crsf.js';

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

test('sendLuaCommand writes discovered command id as a parameter-write frame', async () => {
    const elrs = new ELRS();
    const writes = [];

    elrs.findParameterByName = async (names) => {
        assert.deepEqual(names, ['Enable Rx WiFi', 'Enable WiFi']);
        return { fieldId: 37, name: 'Enable Rx WiFi' };
    };
    elrs.sendRaw = async (data) => {
        writes.push(Array.from(data));
    };

    const result = await elrs.sendLuaCommand(['Enable Rx WiFi', 'Enable WiFi']);

    assert.equal(result.mode, 'lua-parameter');
    assert.equal(result.entry.fieldId, 37);
    assert.deepEqual(writes[0], Array.from(CRSF.buildParameterWritePacket(37, CRSF.LUA_COMMAND_STEP_CLICK)));
});
