import test from 'node:test';
import assert from 'node:assert/strict';

import * as CRSF from '../js/crsf.js';

function expectedCRC(frame) {
    return CRSF.calcCRC(frame.subarray(2, frame.length - 1));
}

test('packChannels and unpackChannels round-trip 16 channels', () => {
    const channels = [
        CRSF.CRSF_CHANNEL_VALUE_MIN,
        300,
        450,
        CRSF.CRSF_CHANNEL_VALUE_MID,
        1200,
        1400,
        1600,
        CRSF.CRSF_CHANNEL_VALUE_MAX,
        172,
        1811,
        1000,
        1100,
        900,
        700,
        500,
        350
    ];

    const packed = CRSF.packChannels(channels);
    assert.equal(packed.length, 22);
    assert.deepEqual(CRSF.unpackChannels(packed), channels);
});

test('buildRCPacket emits a complete 26-byte frame with valid CRC', () => {
    const channels = new Array(16).fill(CRSF.CRSF_CHANNEL_VALUE_MID);
    const frame = CRSF.buildRCPacket(channels);

    assert.equal(frame.length, 26);
    assert.equal(frame[0], CRSF.CRSF_ADDRESS_FLIGHT_CONTROLLER);
    assert.equal(frame[1], 24);
    assert.equal(frame[2], CRSF.CRSF_FRAMETYPE_RC_CHANNELS_PACKED);
    assert.equal(frame.at(-1), expectedCRC(frame));
});

test('buildLinkStatistics frames parse back into the original telemetry fields', () => {
    const stats = {
        uplink_RSSI_1: 60,
        uplink_RSSI_2: 65,
        uplink_Link_quality: 97,
        uplink_SNR: -2,
        active_antenna: 1,
        rf_Mode: 3,
        uplink_TX_Power: 4,
        downlink_RSSI: 70,
        downlink_Link_quality: 99,
        downlink_SNR: 8
    };

    const frame = CRSF.buildLinkStatistics(stats);
    const telemetry = CRSF.parseTelemetry(frame);

    assert.equal(frame.length, 14);
    assert.ok(telemetry);
    assert.equal(telemetry.type, 'link_statistics');
    assert.deepEqual(telemetry.data, stats);
});

test('extended DEVICE_PING frames are complete and parse correctly', () => {
    const frame = CRSF.buildDevicePing();
    const telemetry = CRSF.parseTelemetry(frame);

    assert.equal(frame.length, 6);
    assert.equal(frame[1], 4);
    assert.equal(frame[0], CRSF.CRSF_ADDRESS_RADIO_TRANSMITTER);
    assert.equal(frame.at(-1), expectedCRC(frame));
    assert.ok(telemetry);
    assert.equal(telemetry.type, 'device_ping');
    assert.deepEqual(telemetry.data, {
        destAddr: CRSF.CRSF_ADDRESS_CRSF_TRANSMITTER,
        origAddr: CRSF.CRSF_ADDRESS_RADIO_TRANSMITTER
    });
});

test('extended DEVICE_INFO frames preserve device name', () => {
    const frame = CRSF.buildDeviceInfo(
        CRSF.CRSF_ADDRESS_CRSF_TRANSMITTER,
        CRSF.CRSF_ADDRESS_RADIO_TRANSMITTER,
        'WebRadio'
    );
    const telemetry = CRSF.parseTelemetry(frame);

    assert.ok(telemetry);
    assert.equal(frame[0], CRSF.CRSF_ADDRESS_RADIO_TRANSMITTER);
    assert.equal(telemetry.type, 'device_info');
    assert.equal(telemetry.data.deviceName, 'WebRadio');
    assert.equal(frame.at(-1), expectedCRC(frame));
});

test('bind command matches ELRS Lua parameter-write packet', () => {
    const frame = CRSF.buildBindPacket();
    assert.deepEqual(Array.from(frame), [
        0xEE,
        0x06,
        0x2D,
        0xEE,
        0xEA,
        CRSF.ELRS_PARAMETER_BIND,
        0x01,
        frame[7]
    ]);
    assert.equal(frame[7], CRSF.calcCRC(frame.subarray(2, 7)));
});

test('stream parser emits telemetry once a full frame arrives', () => {
    const frame = CRSF.buildLinkStatistics({
        uplink_RSSI_1: 50,
        uplink_RSSI_2: 55,
        uplink_Link_quality: 100,
        uplink_SNR: 5,
        active_antenna: 0,
        rf_Mode: 2,
        uplink_TX_Power: 3,
        downlink_RSSI: 60,
        downlink_Link_quality: 100,
        downlink_SNR: 4
    });

    const parser = new CRSF.CRSParser();
    const seen = [];
    parser.onTelemetry((telemetry) => seen.push(telemetry));
    parser.pushBytes(frame);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'link_statistics');
    assert.equal(seen[0].data.rf_Mode, 2);
});

test('wifi command matches ELRS Lua parameter-write packet', () => {
    const frame = CRSF.buildWifiPacket();
    assert.deepEqual(Array.from(frame), [
        0xEE,
        0x06,
        0x2D,
        0xEE,
        0xEA,
        CRSF.ELRS_PARAMETER_WIFI,
        0x01,
        frame[7]
    ]);
    assert.equal(frame[7], CRSF.calcCRC(frame.subarray(2, 7)));
});

test('settings write packet matches LetsFly direct serial format', () => {
    const frame = CRSF.buildSettingsWritePacket(0x01, 0x00);
    assert.deepEqual(Array.from(frame), [0xEE, 0x06, 0x2D, 0xEE, 0xEA, 0x01, 0x00, frame[7]]);
    assert.equal(frame[7], CRSF.calcCRC(frame.subarray(2, 7)));
});

test('parameter read packet uses CRSF parameter-read frame type', () => {
    const frame = CRSF.buildParameterReadPacket(0x1F, 0x00);
    assert.deepEqual(Array.from(frame), [0xEE, 0x06, 0x2C, 0xEE, 0xEA, 0x1F, 0x00, frame[7]]);
    assert.equal(frame[7], CRSF.calcCRC(frame.subarray(2, 7)));
});

test('parameter settings entry parses field metadata from chunk 0', () => {
    const name = new TextEncoder().encode('Bind');
    const payload = new Uint8Array(4 + name.length + 1 + 3);
    payload[0] = 0x2A;
    payload[1] = 0x00;
    payload[2] = 0x00;
    payload[3] = 0x0D;
    payload.set(name, 4);

    const frame = CRSF.buildExtendedFrame(
        CRSF.CRSF_FRAMETYPE_PARAMETER_SETTINGS_ENTRY,
        CRSF.CRSF_ADDRESS_RADIO_TRANSMITTER,
        CRSF.CRSF_ADDRESS_CRSF_TRANSMITTER,
        payload
    );

    const telemetry = CRSF.parseTelemetry(frame);
    assert.ok(telemetry);
    assert.equal(telemetry.type, 'parameter_entry');
    assert.deepEqual(telemetry.data, {
        fieldId: 0x2A,
        chunksRemaining: 0,
        parentId: 0x00,
        type: 0x0D,
        name: 'Bind',
        payload
    });
});
