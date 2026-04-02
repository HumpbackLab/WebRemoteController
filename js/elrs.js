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
            disconnected: [],
            error: [],
            devicePing: [],
            deviceInfo: []
        };
        this.lastRCData = null;
        this.rcInterval = null;
        this.rcRate = 100; // Hz, default 100Hz update rate
        this.writeQueue = [];
        this.isWriting = false;
        this.heartbeatInterval = null;
        this.handshakeState = 'idle'; // idle, pinging, ready
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
    async connect(baudRate = 420000) {
        if (!('serial' in navigator)) {
            const error = new Error('Web Serial API not supported. Use Chrome, Edge, or Opera.');
            this.emit('error', error);
            throw error;
        }

        try {
            // Request port from user
            this.port = await navigator.serial.requestPort({
                filters: [] // Allow any USB serial device
            });

            // Open the port
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            });

            // Setup telemetry parser
            this.parser.onTelemetry((telemetry) => {
                this.emit('telemetry', telemetry);
                if (telemetry.type === 'link_statistics') {
                    this.emit('linkStats', telemetry.data);
                } else if (telemetry.type === 'device_ping') {
                    this.emit('devicePing', telemetry.data);
                    this.handleDevicePing(telemetry);
                } else if (telemetry.type === 'device_info') {
                    this.emit('deviceInfo', telemetry.data);
                    this.handleDeviceInfo(telemetry);
                }
            });

            // Start reading
            this.keepReading = true;
            this.readLoop();

            // Start handset handshake
            this.startHandshake();

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

    /**
     * Start handset handshake with ELRS TX
     */
    startHandshake() {
        this.handshakeState = 'pinging';

        // Send initial DEVICE_PING
        this.sendDevicePing();

        // Start periodic heartbeat (send LinkStatistics every 500ms)
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
        // Respond with DEVICE_INFO
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
        this.handshakeState = 'ready';
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
                rf_Mode: 3, // 250Hz
                uplink_TX_Power: 3, // 100mW
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
        while (this.port.readable && this.keepReading) {
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
                console.error('Read error:', error);
                this.emit('error', error);
            } finally {
                if (this.reader) {
                    this.reader.releaseLock();
                }
            }
        }
    }

    /**
     * Disconnect from ELRS TX
     */
    async disconnect() {
        this.stopRCSending();
        this.stopHeartbeat();
        this.keepReading = false;
        this.handshakeState = 'idle';

        // Clear write queue
        this.writeQueue = [];

        if (this.reader) {
            try {
                await this.reader.cancel();
            } catch (e) {
                // Ignore
            }
            this.reader = null;
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
        return this.port && this.port.readable;
    }

    /**
     * Send raw data to ELRS TX (with queue to prevent concurrent writes)
     */
    async sendRaw(data) {
        if (!this.port || !this.port.writable) {
            throw new Error('Not connected');
        }

        // Add to queue and wait for our turn
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

        while (this.writeQueue.length > 0 && this.port && this.port.writable) {
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
        const packet = CRSF.buildBindPacket();
        await this.sendRaw(packet);
        console.log('Bind command sent');
    }

    /**
     * Send WiFi mode command
     */
    async enterWifiMode() {
        // ELRS typically enters WiFi mode by sending a specific command sequence
        // For now, we'll send bind as placeholder - may need specific MSP commands
        const packet = CRSF.buildWifiPacket();
        await this.sendRaw(packet);
        console.log('WiFi mode command sent');
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
