/**
 * ELRS Web Remote Control - Main Controller
 */

import * as CRSF from './crsf.js';
import { getELRS } from './elrs.js';
import { VirtualJoystick } from './joystick.js';
import { getGamepadManager } from './gamepad.js';

// Global state
const state = {
    mode: 'virtual', // 'virtual' or 'gamepad'
    connected: false
};

// Get instances
const elrs = getELRS();
let joystick = null;
const gamepadManager = getGamepadManager();

// DOM Elements
const elements = {
    statusIndicator: document.getElementById('statusIndicator'),
    connectionStatus: document.getElementById('connectionStatus'),
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    modeVirtual: document.getElementById('modeVirtual'),
    modeGamepad: document.getElementById('modeGamepad'),
    gamepadInfo: document.getElementById('gamepadInfo'),
    gamepadSelect: document.getElementById('gamepadSelect'),
    gamepadStatus: document.getElementById('gamepadStatus'),
    bindBtn: document.getElementById('bindBtn'),
    wifiBtn: document.getElementById('wifiBtn'),
    resetBtn: document.getElementById('resetBtn'),
    logPanel: document.getElementById('logPanel')
};

// Initialize
function init() {
    log('Initializing ELRS Web Remote...');

    // Create virtual joystick
    joystick = new VirtualJoystick('joystickContainer');
    joystick.onChange((channels) => {
        if (state.mode === 'virtual' && state.connected) {
            // Channels are sent via the periodic update
        }
    });

    // Setup ELRS callbacks
    setupELRSCallbacks();

    // Setup gamepad callbacks
    setupGamepadCallbacks();

    // Setup UI event listeners
    setupUIEvents();

    // Start channel update loop
    startChannelLoop();

    log('Ready!');
}

function setupELRSCallbacks() {
    elrs.on('connected', () => {
        state.connected = true;
        updateConnectionUI(true);
        log('Connected to ELRS TX');
    });

    elrs.on('disconnected', () => {
        state.connected = false;
        updateConnectionUI(false);
        log('Disconnected from ELRS TX');
    });

    elrs.on('error', (error) => {
        log(`Error: ${error.message}`);
    });

    elrs.on('telemetry', (telemetry) => {
        handleTelemetry(telemetry);
    });

    elrs.on('linkStats', (stats) => {
        updateLinkStats(stats);
    });

    elrs.on('devicePing', (data) => {
        log('DEVICE_PING received from TX');
    });

    elrs.on('deviceInfo', (data) => {
        log(`DEVICE_INFO received: ${data.deviceName}`);
    });
}

function setupGamepadCallbacks() {
    gamepadManager.on('connected', (gamepad) => {
        log(`Gamepad connected: ${gamepad.id}`);
        updateGamepadList();
        elements.gamepadStatus.textContent = gamepad.id;
        elements.gamepadStatus.classList.add('connected');
    });

    gamepadManager.on('disconnected', (gamepad) => {
        log(`Gamepad disconnected: ${gamepad.id}`);
        updateGamepadList();
        if (!gamepadManager.getActiveGamepad()) {
            elements.gamepadStatus.textContent = 'No gamepad connected';
            elements.gamepadStatus.classList.remove('connected');
        }
    });

    gamepadManager.on('change', (channels) => {
        if (state.mode === 'gamepad' && state.connected) {
            // Channels are sent via periodic update
        }
    });
}

function setupUIEvents() {
    // Connect button
    elements.connectBtn.addEventListener('click', async () => {
        try {
            await elrs.connect(420000);
        } catch (error) {
            if (error.name !== 'NotFoundError') {
                log(`Connection failed: ${error.message}`);
            }
        }
    });

    // Disconnect button
    elements.disconnectBtn.addEventListener('click', async () => {
        await elrs.disconnect();
    });

    // Mode buttons
    elements.modeVirtual.addEventListener('click', () => {
        setMode('virtual');
    });

    elements.modeGamepad.addEventListener('click', () => {
        setMode('gamepad');
    });

    // Gamepad select
    elements.gamepadSelect.addEventListener('change', (e) => {
        const index = parseInt(e.target.value);
        if (!isNaN(index)) {
            gamepadManager.setActiveGamepad(index);
        }
    });

    // Bind button
    elements.bindBtn.addEventListener('click', async () => {
        if (state.connected) {
            log('Entering Bind Mode...');
            await elrs.enterBindMode();
        }
    });

    // WiFi button
    elements.wifiBtn.addEventListener('click', async () => {
        if (state.connected) {
            log('Entering WiFi Mode...');
            await elrs.enterWifiMode();
        }
    });

    // Reset button
    elements.resetBtn.addEventListener('click', () => {
        if (joystick) {
            joystick.reset();
        }
        gamepadManager.reset();
        log('Controls reset');
    });
}

function setMode(mode) {
    state.mode = mode;

    // Update UI
    elements.modeVirtual.classList.toggle('active', mode === 'virtual');
    elements.modeGamepad.classList.toggle('active', mode === 'gamepad');
    elements.gamepadInfo.style.display = mode === 'gamepad' ? 'flex' : 'none';

    log(`Mode changed to: ${mode}`);
    updateGamepadList();
}

function updateConnectionUI(connected) {
    elements.statusIndicator.classList.toggle('connected', connected);
    elements.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
    elements.connectBtn.disabled = connected;
    elements.disconnectBtn.disabled = !connected;
    elements.bindBtn.disabled = !connected;
    elements.wifiBtn.disabled = !connected;

    if (connected) {
        // Start sending RC data
        elrs.startRCSending(getCurrentChannels, 100);
    } else {
        elrs.stopRCSending();
    }
}

function updateGamepadList() {
    const gamepads = gamepadManager.getConnectedGamepads();
    elements.gamepadSelect.innerHTML = '<option value="">Select Gamepad</option>';

    gamepads.forEach((gp, i) => {
        if (gp) {
            const option = document.createElement('option');
            option.value = gp.index;
            option.textContent = gp.id || `Gamepad ${gp.index}`;
            elements.gamepadSelect.appendChild(option);
        }
    });

    const active = gamepadManager.getActiveGamepad();
    if (active) {
        elements.gamepadSelect.value = active.index;
        elements.gamepadStatus.textContent = active.id;
        elements.gamepadStatus.classList.add('connected');
    }
}

function getCurrentChannels() {
    if (state.mode === 'virtual') {
        return joystick ? joystick.getChannels() : new Array(16).fill(CRSF.CRSF_CHANNEL_VALUE_MID);
    } else {
        return gamepadManager.getChannels();
    }
}

function startChannelLoop() {
    // Update channel display at 30fps
    setInterval(() => {
        if (joystick) {
            joystick.updateChannelBars();
        }
    }, 33);
}

function handleTelemetry(telemetry) {
    switch (telemetry.type) {
        case 'battery':
            updateBatteryTelemetry(telemetry.data);
            break;
        case 'flight_mode':
            document.getElementById('telMode').textContent = telemetry.data.flight_mode || '--';
            break;
        case 'link_statistics':
            updateLinkStats(telemetry.data);
            break;
    }
}

function updateLinkStats(stats) {
    if (!stats) return;

    const rssi1 = document.getElementById('statRssi1');
    const rssi2 = document.getElementById('statRssi2');
    const lq = document.getElementById('statLQ');
    const snr = document.getElementById('statSNR');
    const rfMode = document.getElementById('statRFMode');
    const power = document.getElementById('statPower');
    const downRssi = document.getElementById('statDownRssi');
    const downLQ = document.getElementById('statDownLQ');

    if (stats.uplink_RSSI_1 !== undefined) {
        rssi1.textContent = `-${stats.uplink_RSSI_1}dBm`;
        setStatClass(rssi1, stats.uplink_RSSI_1, 70, 90);
    }
    if (stats.uplink_RSSI_2 !== undefined) {
        rssi2.textContent = `-${stats.uplink_RSSI_2}dBm`;
        setStatClass(rssi2, stats.uplink_RSSI_2, 70, 90);
    }
    if (stats.uplink_Link_quality !== undefined) {
        lq.textContent = `${stats.uplink_Link_quality}%`;
        setStatClass(lq, 100 - stats.uplink_Link_quality, 30, 50);
    }
    if (stats.uplink_SNR !== undefined) {
        snr.textContent = `${stats.uplink_SNR}dB`;
        setStatClass(snr, -stats.uplink_SNR, 5, 10);
    }
    if (stats.rf_Mode !== undefined) {
        rfMode.textContent = getRFModeName(stats.rf_Mode);
    }
    if (stats.uplink_TX_Power !== undefined) {
        power.textContent = getPowerName(stats.uplink_TX_Power);
    }
    if (stats.downlink_RSSI !== undefined) {
        downRssi.textContent = `-${stats.downlink_RSSI}dBm`;
        setStatClass(downRssi, stats.downlink_RSSI, 70, 90);
    }
    if (stats.downlink_Link_quality !== undefined) {
        downLQ.textContent = `${stats.downlink_Link_quality}%`;
        setStatClass(downLQ, 100 - stats.downlink_Link_quality, 30, 50);
    }
}

function updateBatteryTelemetry(data) {
    if (!data) return;

    const voltage = document.getElementById('telVoltage');
    const current = document.getElementById('telCurrent');
    const capacity = document.getElementById('telCapacity');

    if (data.voltage !== undefined) {
        voltage.textContent = `${data.voltage.toFixed(2)} V`;
    }
    if (data.current !== undefined) {
        current.textContent = `${data.current.toFixed(2)} A`;
    }
    if (data.capacity !== undefined) {
        capacity.textContent = `${data.capacity} mAh`;
    }
}

function setStatClass(element, value, warnThreshold, badThreshold) {
    element.classList.remove('good', 'warn', 'bad');
    if (value >= badThreshold) {
        element.classList.add('bad');
    } else if (value >= warnThreshold) {
        element.classList.add('warn');
    } else {
        element.classList.add('good');
    }
}

function getRFModeName(mode) {
    const modes = ['4fps', '50fps', '150Hz', '250Hz', '500Hz', 'D250', 'D500', 'F500', 'F1000'];
    return modes[mode] || `Mode ${mode}`;
}

function getPowerName(power) {
    const powers = ['0mW', '10mW', '25mW', '100mW', '500mW', '1000mW', '2000mW'];
    return powers[power] || `${power}`;
}

function log(message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="timestamp">[${time}]</span><span class="message">${message}</span>`;

    elements.logPanel.insertBefore(entry, elements.logPanel.firstChild);

    // Keep only last 50 entries
    while (elements.logPanel.children.length > 50) {
        elements.logPanel.removeChild(elements.logPanel.lastChild);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
