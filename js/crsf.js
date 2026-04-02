/**
 * CRSF Protocol Implementation
 * Based on ExpressLRS crsf_protocol.h
 */

// CRSF Constants
export const CRSF_SYNC_BYTE = 0xC8;
export const CRSF_CRC_POLY = 0xD5;
export const CRSF_CHANNEL_VALUE_MIN = 172;   // 987us
export const CRSF_CHANNEL_VALUE_1000 = 191;
export const CRSF_CHANNEL_VALUE_MID = 992;
export const CRSF_CHANNEL_VALUE_2000 = 1792;
export const CRSF_CHANNEL_VALUE_MAX = 1811;   // 2012us

// CRSF Frame Types
export const CRSF_FRAMETYPE_GPS = 0x02;
export const CRSF_FRAMETYPE_BATTERY_SENSOR = 0x08;
export const CRSF_FRAMETYPE_LINK_STATISTICS = 0x14;
export const CRSF_FRAMETYPE_RC_CHANNELS_PACKED = 0x16;
export const CRSF_FRAMETYPE_ATTITUDE = 0x1E;
export const CRSF_FRAMETYPE_FLIGHT_MODE = 0x21;
export const CRSF_FRAMETYPE_DEVICE_PING = 0x28;
export const CRSF_FRAMETYPE_DEVICE_INFO = 0x29;
export const CRSF_FRAMETYPE_COMMAND = 0x32;
export const CRSF_FRAMETYPE_MSP_REQ = 0x7A;
export const CRSF_FRAMETYPE_MSP_RESP = 0x7B;
export const CRSF_FRAMETYPE_MSP_WRITE = 0x7C;

// CRSF Addresses
export const CRSF_ADDRESS_BROADCAST = 0x00;
export const CRSF_ADDRESS_RADIO_TRANSMITTER = 0xEA;
export const CRSF_ADDRESS_CRSF_RECEIVER = 0xEC;
export const CRSF_ADDRESS_CRSF_TRANSMITTER = 0xEE;
export const CRSF_ADDRESS_ELRS_LUA = 0xEF;
export const CRSF_ADDRESS_FLIGHT_CONTROLLER = 0xC8;

// CRSF Commands
export const CRSF_COMMAND_SUBCMD_RX = 0x10;
export const CRSF_COMMAND_SUBCMD_RX_BIND = 0x01;
export const CRSF_COMMAND_SUBCMD_RX_WIFI = 0x02; // Custom for ELRS WiFi

// Precompute CRC8 table
const crcTable = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
        crc = (crc & 0x80) ? ((crc << 1) ^ CRSF_CRC_POLY) : (crc << 1);
    }
    crcTable[i] = crc & 0xFF;
}

/**
 * Calculate CRC8 with polynomial 0xD5
 */
export function calcCRC(data, len = data.length, crc = 0) {
    for (let i = 0; i < len; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xFF];
    }
    return crc;
}

/**
 * Map value from one range to another
 */
function fmap(x, in_min, in_max, out_min, out_max) {
    const result = ((x - in_min) * (out_max - out_min) * 2 / (in_max - in_min) + out_min * 2 + 1) / 2;
    return Math.max(0, Math.min(65535, Math.round(result)));
}

/**
 * Convert 0-1023 (10-bit) to CRSF channel value
 */
export function UINT10_to_CRSF(val) {
    return fmap(val, 0, 1023, CRSF_CHANNEL_VALUE_MIN, CRSF_CHANNEL_VALUE_MAX);
}

/**
 * Convert CRSF channel value to 0-1023 (10-bit)
 */
export function CRSF_to_UINT10(val) {
    return fmap(val, CRSF_CHANNEL_VALUE_MIN, CRSF_CHANNEL_VALUE_MAX, 0, 1023);
}

/**
 * Convert -100% to +100% to CRSF channel value (for joysticks)
 */
export function percentToCRSF(percent) {
    const clamped = Math.max(-100, Math.min(100, percent));
    return fmap(clamped, -100, 100, CRSF_CHANNEL_VALUE_MIN, CRSF_CHANNEL_VALUE_MAX);
}

/**
 * Convert switch position (0-5 or 7 for middle) to CRSF
 */
export function SWITCH3b_to_CRSF(val) {
    switch (val) {
        case 0: return CRSF_CHANNEL_VALUE_1000;
        case 5: return CRSF_CHANNEL_VALUE_2000;
        case 6:
        case 7: return CRSF_CHANNEL_VALUE_MID;
        default:
            return val * 240 + 391;
    }
}

/**
 * Pack 16 channels into 22 bytes (each channel 11 bits)
 * channels: array of 16 values (each 0-2047, but CRSF uses ~172-1811)
 * Based on BetaFlight rx/crsf.cpp / bitpacker_unpack
 */
export function packChannels(channels) {
    const packed = new Uint8Array(22);
    let bitsMerged = 0;
    let writeValue = 0;
    let writeByteIndex = 0;

    for (let ch = 0; ch < 16; ch++) {
        const value = channels[ch] & 0x7FF; // 11 bits
        writeValue |= value << bitsMerged;
        bitsMerged += 11;

        while (bitsMerged >= 8) {
            packed[writeByteIndex++] = writeValue & 0xFF;
            writeValue >>= 8;
            bitsMerged -= 8;
        }
    }

    return packed;
}

/**
 * Unpack 22 bytes back into 16 channels
 * Based on BetaFlight rx/crsf.cpp / bitpacker_unpack
 */
export function unpackChannels(packed) {
    const channels = new Array(16);
    const srcBits = 11;
    const inputChannelMask = (1 << srcBits) - 1;

    let bitsMerged = 0;
    let readValue = 0;
    let readByteIndex = 0;

    for (let ch = 0; ch < 16; ch++) {
        while (bitsMerged < srcBits) {
            const readByte = packed[readByteIndex++];
            readValue |= readByte << bitsMerged;
            bitsMerged += 8;
        }

        channels[ch] = readValue & inputChannelMask;
        readValue >>= srcBits;
        bitsMerged -= srcBits;
    }

    return channels;
}

/**
 * Build a complete CRSF RC packet
 * @param {number[]} channels - 16 channel values
 * @returns {Uint8Array} Complete CRSF packet
 */
export function buildRCPacket(channels) {
    const packedChannels = packChannels(channels);
    const payloadSize = packedChannels.length;
    const packet = new Uint8Array(2 + payloadSize + 1); // addr + len + type + payload + crc

    let idx = 0;
    packet[idx++] = CRSF_ADDRESS_FLIGHT_CONTROLLER;
    packet[idx++] = payloadSize + 2; // type + payload + crc
    packet[idx++] = CRSF_FRAMETYPE_RC_CHANNELS_PACKED;
    packet.set(packedChannels, idx);
    idx += payloadSize;

    // Calculate CRC from type onwards (index 2, length = type + payload = 1 + payloadSize)
    const crc = calcCRC(packet.subarray(2, 2 + 1 + payloadSize));
    packet[idx] = crc;

    return packet;
}

/**
 * Build a Bind command packet
 */
export function buildBindPacket() {
    const payload = new Uint8Array([
        CRSF_COMMAND_SUBCMD_RX,
        CRSF_COMMAND_SUBCMD_RX_BIND
    ]);

    const packet = new Uint8Array(2 + payload.length + 1);
    let idx = 0;
    packet[idx++] = CRSF_ADDRESS_CRSF_RECEIVER;
    packet[idx++] = payload.length + 2;
    packet[idx++] = CRSF_FRAMETYPE_COMMAND;
    packet.set(payload, idx);
    idx += payload.length;

    // Calculate CRC from type onwards
    const crc = calcCRC(packet.subarray(2, 2 + 1 + payload.length));
    packet[idx] = crc;

    return packet;
}

/**
 * Build a WiFi mode command packet
 * Note: ELRS uses specific MSP commands for WiFi mode
 */
export function buildWifiPacket() {
    // ELRS WiFi mode is typically triggered by MSP command 0x3002 (MSP_ELRS_WIFI)
    // For now, we'll use a command frame or fall back to just sending bind as placeholder
    // In practice, you need to send the correct MSP command

    // Placeholder: send the same as bind for now - will need to update with actual WiFi command
    return buildBindPacket();
}

/**
 * Parse Link Statistics (0x14 frame type)
 */
export function parseLinkStatistics(payload) {
    if (payload.length < 10) return null;

    return {
        uplink_RSSI_1: payload[0],
        uplink_RSSI_2: payload[1],
        uplink_Link_quality: payload[2],
        uplink_SNR: payload[3] << 24 >> 24, // int8
        active_antenna: payload[4],
        rf_Mode: payload[5],
        uplink_TX_Power: payload[6],
        downlink_RSSI: payload[7],
        downlink_Link_quality: payload[8],
        downlink_SNR: payload[9] << 24 >> 24
    };
}

/**
 * Parse Battery Sensor (0x08 frame type)
 */
export function parseBatterySensor(payload) {
    if (payload.length < 8) return null;

    const voltage = (payload[0] << 8) | payload[1];
    const current = (payload[2] << 8) | payload[3];
    const capacity = (payload[4] << 16) | (payload[5] << 8) | payload[6];
    const remaining = payload[7];

    return {
        voltage: voltage / 10, // volts
        current: current / 10, // amps
        capacity: capacity,     // mAh
        remaining: remaining    // percent
    };
}

/**
 * Parse GPS (0x02 frame type)
 */
export function parseGPS(payload) {
    if (payload.length < 15) return null;

    const view = new DataView(payload.buffer);
    return {
        latitude: view.getInt32(0, false) / 10000000,
        longitude: view.getInt32(4, false) / 10000000,
        groundspeed: view.getUint16(8, false) / 10,
        gps_heading: view.getUint16(10, false) / 100,
        altitude: view.getUint16(12, false) - 1000,
        satellites_in_use: payload[14]
    };
}

/**
 * Parse Attitude (0x1E frame type)
 */
export function parseAttitude(payload) {
    if (payload.length < 6) return null;

    const view = new DataView(payload.buffer);
    return {
        pitch: view.getInt16(0, false) / 10000,
        roll: view.getInt16(2, false) / 10000,
        yaw: view.getInt16(4, false) / 10000
    };
}

/**
 * Parse Flight Mode (0x21 frame type)
 */
export function parseFlightMode(payload) {
    let end = 0;
    while (end < payload.length && payload[end] !== 0) end++;
    return {
        flight_mode: String.fromCharCode.apply(null, payload.subarray(0, end))
    };
}

/**
 * Parse a CRSF telemetry packet
 * @param {Uint8Array} data - Complete CRSF packet
 * @returns {object|null} Parsed telemetry data or null
 */
export function parseTelemetry(data) {
    if (data.length < 4) return null;

    const deviceAddr = data[0];
    const frameSize = data[1];
    const frameType = data[2];

    if (data.length < frameSize + 2) return null; // Need at least addr + frameSize bytes

    const payload = data.subarray(3, 2 + frameSize);
    const receivedCRC = data[2 + frameSize];
    // CRC is calculated from type (index 2) onwards, length = frameSize - 1 (skip CRC itself)
    const calculatedCRC = calcCRC(data.subarray(2, 2 + frameSize));

    if (receivedCRC !== calculatedCRC) {
        console.warn(`CRC mismatch: got ${receivedCRC}, expected ${calculatedCRC}`);
        return null;
    }

    let result = {
        deviceAddr,
        frameType,
        raw: data
    };

    switch (frameType) {
        case CRSF_FRAMETYPE_LINK_STATISTICS:
            result.type = 'link_statistics';
            result.data = parseLinkStatistics(payload);
            break;
        case CRSF_FRAMETYPE_BATTERY_SENSOR:
            result.type = 'battery';
            result.data = parseBatterySensor(payload);
            break;
        case CRSF_FRAMETYPE_GPS:
            result.type = 'gps';
            result.data = parseGPS(payload);
            break;
        case CRSF_FRAMETYPE_ATTITUDE:
            result.type = 'attitude';
            result.data = parseAttitude(payload);
            break;
        case CRSF_FRAMETYPE_FLIGHT_MODE:
            result.type = 'flight_mode';
            result.data = parseFlightMode(payload);
            break;
        default:
            result.type = 'unknown';
            result.data = payload;
    }

    return result;
}

/**
 * CRSF Parser State Machine for streaming data
 */
export class CRSParser {
    constructor() {
        this.state = 'IDLE'; // IDLE, RECEIVING_LENGTH, RECEIVING_DATA
        this.buffer = [];
        this.expectedLength = 0;
        this.callbacks = [];
    }

    onTelemetry(callback) {
        this.callbacks.push(callback);
    }

    pushByte(byte) {
        switch (this.state) {
            case 'IDLE':
                if (byte === CRSF_ADDRESS_RADIO_TRANSMITTER ||
                    byte === CRSF_ADDRESS_CRSF_RECEIVER ||
                    byte === CRSF_ADDRESS_FLIGHT_CONTROLLER ||
                    byte === CRSF_ADDRESS_CRSF_TRANSMITTER) {
                    this.buffer = [byte];
                    this.state = 'RECEIVING_LENGTH';
                }
                break;

            case 'RECEIVING_LENGTH':
                this.buffer.push(byte);
                this.expectedLength = byte + 2; // frameSize doesn't include addr and itself
                this.state = 'RECEIVING_DATA';
                break;

            case 'RECEIVING_DATA':
                this.buffer.push(byte);
                if (this.buffer.length >= this.expectedLength) {
                    const packet = new Uint8Array(this.buffer);
                    const telemetry = parseTelemetry(packet);
                    if (telemetry) {
                        this.callbacks.forEach(cb => cb(telemetry));
                    }
                    this.state = 'IDLE';
                    this.buffer = [];
                }
                break;
        }
    }

    pushBytes(bytes) {
        for (const byte of bytes) {
            this.pushByte(byte);
        }
    }
}
