/**
 * ELRS TX Communication Layer
 * Handles Web Serial connection and communication with ELRS TX module
 */

import * as CRSF from './crsf.js';

export class ELRS {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.keepReading = false;
        this.parser = new CRSF.CRSParser();
        this.callbacks = {
            telemetry: [],
            linkStats: [],
            connected: [],
            ready: [],
            disconnected: [],
            error: [],
            devicePing: [],
            deviceInfo: [],
            parameterEntry: []
        };
        this.lastRCData = null;
        this.rcInterval = null;
        this.rcRate = 100; // Hz, default 100Hz update rate
        this.writeQueue = [];
        this.isWriting = false;
        this.heartbeatInterval = null;
        this.handshakeState = 'idle'; // idle, pinging, ready
        this.connectionMode = 'direct-serial';
        this.parameterCache = new Map();
        this.pendingParameterResolvers = new Map();

        this.parser.onTelemetry((telemetry) => {
            this.emit('telemetry', telemetry);
            if (telemetry.type === 'link_statistics') {
                this.emit('linkStats', telemetry.data);
                this.markHandshakeReady();
            } else if (telemetry.type === 'device_ping') {
                this.emit('devicePing', telemetry.data);
                this.handleDevicePing(telemetry);
                this.markHandshakeReady();
            } else if (telemetry.type === 'device_info') {
                this.emit('deviceInfo', telemetry.data);
                this.handleDeviceInfo(telemetry);
            } else if (telemetry.type === 'parameter_entry' && telemetry.data) {
                this.handleParameterEntry(telemetry.data);
            }
        });
    }

    /**
     * Register callback for telemetry data
     */
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }

    /**
     * Emit an event
     */
    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => cb(data));
        }
    }

    /**
     * Connect to ELRS TX via Web Serial
     */
    async connect(baudRate = 115200, options = {}) {
        if (!('serial' in navigator)) {
            const error = new Error('Web Serial API not supported. Use Chrome, Edge, or Opera.');
            this.emit('error', error);
            throw error;
        }

        this.connectionMode = options.mode || 'direct-serial';

        try {
            this.port = await navigator.serial.requestPort({
                filters: []
            });

            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            });

            this.keepReading = true;
            this.parser.reset();
            this.parameterCache.clear();
            this.pendingParameterResolvers.clear();
            this.readLoop();
            if (this.connectionMode === 'handset') {
                this.startHandshake();
            }
            this.emit('connected');

            return true;
        } catch (error) {
            if (error.name !== 'NotFoundError') {
                console.error('Connection error:', error);
                this.emit('error', error);
            }
            throw error;
        }
    }

    markHandshakeReady() {
        if (this.handshakeState === 'ready') {
            return;
        }

        this.handshakeState = 'ready';
        this.emit('ready');
    }

    /**
     * Start handset handshake with ELRS TX
     */
    startHandshake() {
        this.handshakeState = 'pinging';
        this.sendDevicePing();
        this.startHeartbeat();
    }

    /**
     * Send DEVICE_PING to TX
     */
    async sendDevicePing() {
        if (!this.isConnected()) return;
        try {
            const packet = CRSF.buildDevicePing();
            await this.sendRaw(packet);
            console.log('DEVICE_PING sent');
        } catch (e) {
            console.error('Failed to send DEVICE_PING:', e);
        }
    }

    /**
     * Handle received DEVICE_PING (from TX)
     */
    async handleDevicePing(telemetry) {
        console.log('Received DEVICE_PING from TX');
        try {
            const packet = CRSF.buildDeviceInfo(
                telemetry.origAddr || CRSF.CRSF_ADDRESS_CRSF_TRANSMITTER,
                CRSF.CRSF_ADDRESS_RADIO_TRANSMITTER,
                'WebRadio'
            );
            await this.sendRaw(packet);
            console.log('DEVICE_INFO sent in response');
        } catch (e) {
            console.error('Failed to send DEVICE_INFO:', e);
        }
    }

    /**
     * Handle received DEVICE_INFO (from TX)
     */
    handleDeviceInfo(telemetry) {
        console.log('Received DEVICE_INFO from TX:', telemetry.data.deviceName);
        this.markHandshakeReady();
    }

    /**
     * Start periodic heartbeat (LinkStatistics)
     */
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 500);
    }

    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Send LinkStatistics heartbeat
     */
    async sendHeartbeat() {
        if (!this.isConnected()) return;
        try {
            const stats = {
                uplink_RSSI_1: 60,
                uplink_RSSI_2: 65,
                uplink_Link_quality: 100,
                uplink_SNR: 10,
                active_antenna: 0,
                rf_Mode: 3,
                uplink_TX_Power: 3,
                downlink_RSSI: 70,
                downlink_Link_quality: 100,
                downlink_SNR: 8
            };
            const packet = CRSF.buildLinkStatistics(stats);
            await this.sendRaw(packet);
        } catch (e) {
            // Ignore heartbeat errors
        }
    }

    /**
     * Read loop for serial data
     */
    async readLoop() {
        while (this.port?.readable && this.keepReading) {
            try {
                this.reader = this.port.readable.getReader();

                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value) {
                        this.parser.pushBytes(value);
                    }
                }
            } catch (error) {
                if (this.keepReading) {
                    console.error('Read error:', error);
                    this.emit('error', error);
                }
            } finally {
                if (this.reader) {
                    this.reader.releaseLock();
                    this.reader = null;
                }
            }
        }
    }

    rejectPendingWrites(error) {
        while (this.writeQueue.length > 0) {
            const { reject } = this.writeQueue.shift();
            reject(error);
        }
        this.isWriting = false;
    }

    /**
     * Disconnect from ELRS TX
     */
    async disconnect() {
        this.stopRCSending();
        this.stopHeartbeat();
        this.keepReading = false;
        this.handshakeState = 'idle';
        this.connectionMode = 'direct-serial';
        this.parser.reset();
        this.parameterCache.clear();
        this.pendingParameterResolvers.clear();
        this.rejectPendingWrites(new Error('Disconnected'));

        if (this.reader) {
            try {
                await this.reader.cancel();
            } catch (e) {
                // Ignore
            }
        }

        if (this.port) {
            await this.port.close();
            this.port = null;
        }

        this.emit('disconnected');
    }

    /**
     * Check if connected
     */
    isConnected() {
        return Boolean(this.port?.readable && this.port?.writable);
    }

    /**
     * Send raw data to ELRS TX (with queue to prevent concurrent writes)
     */
    async sendRaw(data) {
        if (!this.port || !this.port.writable) {
            throw new Error('Not connected');
        }

        await new Promise((resolve, reject) => {
            this.writeQueue.push({ data, resolve, reject });
            this.processWriteQueue();
        });
    }

    /**
     * Process the write queue sequentially
     */
    async processWriteQueue() {
        if (this.isWriting || this.writeQueue.length === 0) {
            return;
        }

        this.isWriting = true;

        while (this.writeQueue.length > 0 && this.port?.writable) {
            const { data, resolve, reject } = this.writeQueue.shift();

            try {
                const writer = this.port.writable.getWriter();
                try {
                    await writer.write(data);
                    resolve();
                } finally {
                    writer.releaseLock();
                }
            } catch (error) {
                reject(error);
            }
        }

        if (this.writeQueue.length > 0 && !this.port?.writable) {
            this.rejectPendingWrites(new Error('Port is no longer writable'));
            return;
        }

        this.isWriting = false;
    }

    /**
     * Send RC channels data
     */
    async sendRC(channels) {
        const packet = CRSF.buildRCPacket(channels);
        this.lastRCData = channels;
        await this.sendRaw(packet);
    }

    handleParameterEntry(entry) {
        this.parameterCache.set(entry.fieldId, entry);
        this.emit('parameterEntry', entry);

        const resolver = this.pendingParameterResolvers.get(entry.fieldId);
        if (resolver) {
            this.pendingParameterResolvers.delete(entry.fieldId);
            resolver(entry);
        }
    }

    async readParameter(fieldId, timeoutMs = 250) {
        const cached = this.parameterCache.get(fieldId);
        if (cached && cached.chunksRemaining === 0) {
            return cached;
        }

        const packet = CRSF.buildParameterReadPacket(fieldId, 0);

        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingParameterResolvers.delete(fieldId);
                reject(new Error(`Timed out reading parameter ${fieldId}`));
            }, timeoutMs);

            this.pendingParameterResolvers.set(fieldId, (entry) => {
                clearTimeout(timeoutId);
                resolve(entry);
            });

            try {
                await this.sendRaw(packet);
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingParameterResolvers.delete(fieldId);
                reject(error);
            }
        });
    }

    async findParameterByName(names, maxFieldId = 63) {
        const wantedNames = Array.isArray(names) ? names : [names];

        for (const entry of this.parameterCache.values()) {
            if (wantedNames.includes(entry.name)) {
                return entry;
            }
        }

        for (let fieldId = 1; fieldId <= maxFieldId; fieldId += 1) {
            let entry = this.parameterCache.get(fieldId);
            if (!entry) {
                try {
                    entry = await this.readParameter(fieldId);
                } catch (_error) {
                    continue;
                }
            }

            if (entry && wantedNames.includes(entry.name)) {
                return entry;
            }
        }

        return null;
    }

    async sendLuaCommand(names, fallbackPacketBuilder = null) {
        const entry = await this.findParameterByName(names);
        if (entry) {
            const packet = CRSF.buildParameterWritePacket(entry.fieldId, CRSF.LUA_COMMAND_STEP_CLICK);
            await this.sendRaw(packet);
            return { mode: 'lua-parameter', entry };
        }

        if (fallbackPacketBuilder) {
            await this.sendRaw(fallbackPacketBuilder());
            return { mode: 'legacy-fallback', entry: null };
        }

        throw new Error(`Command not found: ${Array.isArray(names) ? names.join(', ') : names}`);
    }

    /**
     * Start sending RC data at specified rate
     */
    startRCSending(channelProvider, rate = 100) {
        this.stopRCSending();
        this.rcRate = rate;
        const intervalMs = 1000 / rate;

        this.rcInterval = setInterval(async () => {
            if (!this.isConnected()) return;

            try {
                const channels = channelProvider();
                await this.sendRC(channels);
            } catch (error) {
                console.error('Error sending RC:', error);
            }
        }, intervalMs);
    }

    /**
     * Stop sending RC data
     */
    stopRCSending() {
        if (this.rcInterval) {
            clearInterval(this.rcInterval);
            this.rcInterval = null;
        }
    }

    /**
     * Send Bind command
     */
    async enterBindMode() {
        await this.sendLuaCommand('Bind', () => CRSF.buildBindPacket());
        console.log('Bind command sent');
    }

    /**
     * Send WiFi mode command
     */
    async enterWifiMode() {
        await this.sendLuaCommand(['Enable Rx WiFi', 'Enable WiFi'], () => CRSF.buildWifiPacket());
        console.log('WiFi mode command sent');
    }

    supportsWifiMode() {
        return this.connectionMode === 'direct-serial';
    }

    /**
     * Get last sent RC data
     */
    getLastRCData() {
        return this.lastRCData;
    }
}

// Singleton instance
export let elrsInstance = null;

export function getELRS() {
    if (!elrsInstance) {
        elrsInstance = new ELRS();
    }
    return elrsInstance;
}
