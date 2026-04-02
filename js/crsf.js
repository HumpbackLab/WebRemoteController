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
export const CRSF_FRAMETYPE_PARAMETER_SETTINGS_ENTRY = 0x2B;
export const CRSF_FRAMETYPE_PARAMETER_READ = 0x2C;
export const CRSF_FRAMETYPE_PARAMETER_WRITE = 0x2D;
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
export const ELRS_PARAMETER_PING = 0x00;
export const ELRS_PARAMETER_WIFI = 0xFE;
export const ELRS_PARAMETER_BIND = 0xFF;
export const LUA_COMMAND_STEP_IDLE = 0;
export const LUA_COMMAND_STEP_CLICK = 1;
export const LUA_COMMAND_STEP_EXECUTING = 2;
export const LUA_COMMAND_STEP_ASK_CONFIRM = 3;
export const LUA_COMMAND_STEP_CONFIRMED = 4;
export const LUA_COMMAND_STEP_CANCEL = 5;
export const LUA_COMMAND_STEP_QUERY = 6;

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
    const packet = new Uint8Array(2 + 1 + payloadSize + 1); // addr + len + type + payload + crc

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
 * Build an ELRS parameter write packet for direct serial control.
 * Packet format matches the ELRS Lua script:
 * [0xEE][0x06][0x2D][0xEE][0xEA][parameter][value][crc]
 */
function buildParameterAccessPacket(frameType, parameter, value) {
    const packet = new Uint8Array(8);
    packet[0] = CRSF_ADDRESS_CRSF_TRANSMITTER;
    packet[1] = 6;
    packet[2] = frameType;
    packet[3] = CRSF_ADDRESS_CRSF_TRANSMITTER;
    packet[4] = CRSF_ADDRESS_RADIO_TRANSMITTER;
    packet[5] = parameter & 0xFF;
    packet[6] = value & 0xFF;
    packet[7] = calcCRC(packet.subarray(2, 7));
    return packet;
}

export function buildSettingsWritePacket(command, value) {
    return buildParameterAccessPacket(CRSF_FRAMETYPE_PARAMETER_WRITE, command, value);
}

export function buildParameterReadPacket(parameter, chunk = 0) {
    return buildParameterAccessPacket(CRSF_FRAMETYPE_PARAMETER_READ, parameter, chunk);
}

export function buildParameterWritePacket(parameter, value) {
    return buildParameterAccessPacket(CRSF_FRAMETYPE_PARAMETER_WRITE, parameter, value);
}

/**
 * Build a Bind command packet
 */
export function buildBindPacket() {
    return buildSettingsWritePacket(ELRS_PARAMETER_BIND, 0x01);
}

/**
 * Build a WiFi mode command packet
 */
export function buildWifiPacket() {
    return buildSettingsWritePacket(ELRS_PARAMETER_WIFI, 0x01);
}

/**
 * Build an Extended Header frame (DEVICE_PING, DEVICE_INFO, etc.)
 * Extended frame format: [addr][len][type][dest][orig][payload...][crc]
 */
export function buildExtendedFrame(frameType, destAddr, origAddr, payload = new Uint8Array(0)) {
    const payloadSize = payload.length;
    // frame_size = type + dest + orig + payload + crc
    const frameSize = payloadSize + 4;
    const packet = new Uint8Array(2 + frameSize); // addr + len + type + dest + orig + payload + crc

    let idx = 0;
    packet[idx++] = origAddr;          // handset serial address
    packet[idx++] = frameSize;         // frame_size (after this byte: type + dest + orig + payload + crc)
    packet[idx++] = frameType;         // type
    packet[idx++] = destAddr;          // dest_addr (扩展头)
    packet[idx++] = origAddr;          // orig_addr (扩展头)
    packet.set(payload, idx);           // payload
    idx += payloadSize;

    // CRC 从 type (索引 2) 开始计算，长度 = frameSize - 1 (跳过最后的 CRC)
    const crc = calcCRC(packet.subarray(2, 2 + frameSize - 1));
    packet[idx] = crc;

    return packet;
}

/**
 * Build a DEVICE_PING packet (handset → TX)
 */
export function buildDevicePing() {
    return buildExtendedFrame(
        CRSF_FRAMETYPE_DEVICE_PING,
        CRSF_ADDRESS_CRSF_TRANSMITTER,
        CRSF_ADDRESS_RADIO_TRANSMITTER
    );
}

/**
 * Build a DEVICE_INFO response packet (TX → handset, or handset → TX)
 */
export function buildDeviceInfo(destAddr, origAddr, deviceName = 'WebRadio') {
    // Payload format: [device_name][serial(4)][hw_ver(4)][sw_ver(4)][field_cnt(1)][param_ver(1)]
    const nameBytes = new TextEncoder().encode(deviceName);
    const payload = new Uint8Array(nameBytes.length + 1 + 4 + 4 + 4 + 1 + 1);

    let idx = 0;
    payload.set(nameBytes, idx);
    idx += nameBytes.length;
    payload[idx++] = 0;  // null terminator for string

    // Serial number: 'ELRS' (0x454C5253)
    payload[idx++] = 0x45; payload[idx++] = 0x4C;
    payload[idx++] = 0x52; payload[idx++] = 0x53;

    // Hardware version (0)
    payload[idx++] = 0x00; payload[idx++] = 0x00;
    payload[idx++] = 0x00; payload[idx++] = 0x00;

    // Software version (1.0.0)
    payload[idx++] = 0x00; payload[idx++] = 0x00;
    payload[idx++] = 0x01; payload[idx++] = 0x00;

    // Field count and parameter version
    payload[idx++] = 0x00;  // field_cnt
    payload[idx++] = 0x00;  // parameter_version

    return buildExtendedFrame(
        CRSF_FRAMETYPE_DEVICE_INFO,
        destAddr,
        origAddr,
        payload
    );
}

/**
 * Build a Link Statistics packet (handset → TX)
 */
export function buildLinkStatistics(stats = {}) {
    const payload = new Uint8Array(10);

    payload[0] = stats.uplink_RSSI_1 || 0;
    payload[1] = stats.uplink_RSSI_2 || 0;
    payload[2] = stats.uplink_Link_quality || 100;
    payload[3] = stats.uplink_SNR || 0;
    payload[4] = stats.active_antenna || 0;
    payload[5] = stats.rf_Mode || 0;
    payload[6] = stats.uplink_TX_Power || 0;
    payload[7] = stats.downlink_RSSI || 0;
    payload[8] = stats.downlink_Link_quality || 100;
    payload[9] = stats.downlink_SNR || 0;

    const packet = new Uint8Array(2 + 1 + 10 + 1); // addr + len + type + payload + crc
    let idx = 0;
    packet[idx++] = CRSF_ADDRESS_RADIO_TRANSMITTER;
    packet[idx++] = 1 + 10 + 1;  // type + payload + crc
    packet[idx++] = CRSF_FRAMETYPE_LINK_STATISTICS;
    packet.set(payload, idx);
    idx += 10;

    const crc = calcCRC(packet.subarray(2, 2 + 1 + 10));
    packet[idx] = crc;

    return packet;
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

export function parseParameterSettingsEntry(payload) {
    if (payload.length < 4) return null;

    const fieldId = payload[0];
    const chunksRemaining = payload[1];
    const parentId = payload[2];
    const type = payload[3] & 0x3F;

    let nameEnd = 4;
    while (nameEnd < payload.length && payload[nameEnd] !== 0) {
        nameEnd += 1;
    }

    const name = String.fromCharCode.apply(null, payload.subarray(4, nameEnd));

    return {
        fieldId,
        chunksRemaining,
        parentId,
        type,
        name,
        payload
    };
}

/**
 * Check if frame type is an Extended Header frame
 * Extended frames have dest_addr and orig_addr after type
 */
function isExtendedFrame(frameType) {
    return frameType >= 0x28 && frameType <= 0x96;
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

    // Determine payload start based on frame type
    let payloadStart = 3;
    let destAddr = null;
    let origAddr = null;

    if (isExtendedFrame(frameType)) {
        // Extended Header frame: [addr][len][type][dest][orig][payload...]
        if (data.length < 6) return null; // Need at least addr + len + type + dest + orig
        destAddr = data[3];
        origAddr = data[4];
        payloadStart = 5;
    }

    const payload = data.subarray(payloadStart, frameSize + 1);
    const receivedCRC = data[frameSize + 1];
    // CRC is calculated from type (index 2) onwards, length = frameSize - 1 (skip CRC itself)
    const calculatedCRC = calcCRC(data.subarray(2, frameSize + 1));

    if (receivedCRC !== calculatedCRC) {
        console.warn(`CRC mismatch: got ${receivedCRC}, expected ${calculatedCRC}`);
        return null;
    }

    let result = {
        deviceAddr,
        frameType,
        destAddr,
        origAddr,
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
        case CRSF_FRAMETYPE_DEVICE_PING:
            result.type = 'device_ping';
            result.data = { destAddr, origAddr };
            break;
        case CRSF_FRAMETYPE_DEVICE_INFO:
            result.type = 'device_info';
            // Parse device info payload
            let end = 0;
            while (end < payload.length && payload[end] !== 0) end++;
            const deviceName = String.fromCharCode.apply(null, payload.subarray(0, end));
            result.data = { deviceName, destAddr, origAddr, payload };
            break;
        case CRSF_FRAMETYPE_PARAMETER_SETTINGS_ENTRY:
            result.type = 'parameter_entry';
            result.data = parseParameterSettingsEntry(payload);
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

    reset() {
        this.state = 'IDLE';
        this.buffer = [];
        this.expectedLength = 0;
    }

    pushByte(byte) {
        switch (this.state) {
            case 'IDLE':
                // Accept all valid CRSF addresses
                if (byte === CRSF_ADDRESS_RADIO_TRANSMITTER ||
                    byte === CRSF_ADDRESS_CRSF_RECEIVER ||
                    byte === CRSF_ADDRESS_FLIGHT_CONTROLLER ||
                    byte === CRSF_ADDRESS_CRSF_TRANSMITTER ||
                    byte === CRSF_ADDRESS_BROADCAST ||
                    byte === CRSF_ADDRESS_ELRS_LUA) {
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
                    this.reset();
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
