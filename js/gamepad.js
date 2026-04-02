/**
 * Gamepad API Support
 * Handles physical gamepads/joysticks connected to the computer
 */

import * as CRSF from './crsf.js';

export class GamepadManager {
    constructor() {
        this.gamepads = new Map();
        this.activeGamepad = null;
        this.callbacks = [];
        this.channels = new Array(16).fill(CRSF.CRSF_CHANNEL_VALUE_MID);
        this.channels[2] = CRSF.CRSF_CHANNEL_VALUE_MIN; // Throttle starts at min

        // Default mapping: Xbox/PS4 style layout
        this.mapping = {
            // Axes: [channel index, invert]
            axes: {
                0: { ch: 0, invert: false }, // Left X -> Roll (CH1)
                1: { ch: 1, invert: true },  // Left Y -> Pitch (CH2, inverted)
                2: { ch: 3, invert: false }, // Right X -> Yaw (CH4)
                3: { ch: 2, invert: true }   // Right Y -> Throttle (CH3, inverted)
            },
            // Buttons: [channel index, toggle, 3-position]
            buttons: {
                0: { ch: 4, toggle: true },  // A -> AUX1
                1: { ch: 5, toggle: false, threePos: true }, // B -> AUX2 (3-pos)
                2: { ch: 6, toggle: true },  // X -> AUX3
                3: { ch: 7, toggle: true },  // Y -> AUX4
                4: { ch: 8, toggle: true },  // LB -> AUX5
                5: { ch: 9, toggle: true },  // RB -> AUX6
                6: { ch: 10, toggle: true }, // LT -> AUX7
                7: { ch: 11, toggle: true }, // RT -> AUX8
                8: { ch: 12, toggle: true }, // Select -> AUX9
                9: { ch: 13, toggle: true }, // Start -> AUX10
                10: { ch: 14, toggle: true }, // L3 -> AUX11
                11: { ch: 15, toggle: true }  // R3 -> AUX12
            }
        };

        this.buttonStates = {}; // Track toggle states
        this.threePosStates = {}; // Track 3-position states
        this.lastButtonValues = {};

        this.bindEvents();
        this.startPolling();
    }

    bindEvents() {
        window.addEventListener('gamepadconnected', (e) => {
            console.log('Gamepad connected:', e.gamepad.id);
            this.gamepads.set(e.gamepad.index, e.gamepad);
            if (!this.activeGamepad) {
                this.activeGamepad = e.gamepad.index;
            }
            this.emit('connected', e.gamepad);
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            console.log('Gamepad disconnected:', e.gamepad.id);
            this.gamepads.delete(e.gamepad.index);
            if (this.activeGamepad === e.gamepad.index) {
                this.activeGamepad = this.gamepads.size > 0 ?
                    Array.from(this.gamepads.keys())[0] : null;
            }
            this.emit('disconnected', e.gamepad);
        });
    }

    startPolling() {
        setInterval(() => this.update(), 16); // ~60Hz
    }

    update() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = gamepads[this.activeGamepad];

        if (!gamepad) return;

        // Update axes
        this.updateAxes(gamepad.axes);

        // Update buttons
        this.updateButtons(gamepad.buttons);

        this.emit('change', this.channels);
    }

    updateAxes(axes) {
        for (let i = 0; i < axes.length; i++) {
            const mapping = this.mapping.axes[i];
            if (!mapping) continue;

            let value = axes[i];

            // Apply deadzone
            const deadzone = 0.05;
            if (Math.abs(value) < deadzone) {
                value = 0;
            } else {
                // Rescale after deadzone
                const sign = value > 0 ? 1 : -1;
                value = (Math.abs(value) - deadzone) / (1 - deadzone) * sign;
            }

            if (mapping.invert) {
                value = -value;
            }

            // Special handling for throttle: map from -1..1 to 0..1 (only use upper half)
            if (mapping.ch === 2) {
                // Right Y: pull down for throttle up
                value = (value + 1) / 2; // 0..1
                const range = CRSF.CRSF_CHANNEL_VALUE_MAX - CRSF.CRSF_CHANNEL_VALUE_MIN;
                this.channels[mapping.ch] = Math.round(CRSF.CRSF_CHANNEL_VALUE_MIN + value * range);
            } else {
                // Normal stick: -1..1 centered
                const range = CRSF.CRSF_CHANNEL_VALUE_MAX - CRSF.CRSF_CHANNEL_VALUE_MID;
                this.channels[mapping.ch] = Math.round(CRSF.CRSF_CHANNEL_VALUE_MID + value * range);
            }
        }
    }

    updateButtons(buttons) {
        for (let i = 0; i < buttons.length; i++) {
            const mapping = this.mapping.buttons[i];
            if (!mapping) continue;

            const currentValue = buttons[i].pressed;
            const lastValue = this.lastButtonValues[i] || false;

            // Rising edge detection
            if (currentValue && !lastValue) {
                if (mapping.threePos) {
                    // 3-position switch: cycle through min -> mid -> max
                    this.threePosStates[i] = ((this.threePosStates[i] || 0) + 1) % 3;
                    switch (this.threePosStates[i]) {
                        case 0:
                            this.channels[mapping.ch] = CRSF.CRSF_CHANNEL_VALUE_MIN;
                            break;
                        case 1:
                            this.channels[mapping.ch] = CRSF.CRSF_CHANNEL_VALUE_MID;
                            break;
                        case 2:
                            this.channels[mapping.ch] = CRSF.CRSF_CHANNEL_VALUE_MAX;
                            break;
                    }
                } else if (mapping.toggle) {
                    // Toggle switch
                    this.buttonStates[i] = !(this.buttonStates[i] || false);
                    this.channels[mapping.ch] = this.buttonStates[i] ?
                        CRSF.CRSF_CHANNEL_VALUE_MAX : CRSF.CRSF_CHANNEL_VALUE_MIN;
                } else {
                    // Momentary
                    this.channels[mapping.ch] = CRSF.CRSF_CHANNEL_VALUE_MAX;
                }
            } else if (!currentValue && lastValue && !mapping.toggle && !mapping.threePos) {
                // Momentary release
                this.channels[mapping.ch] = CRSF.CRSF_CHANNEL_VALUE_MIN;
            }

            this.lastButtonValues[i] = currentValue;
        }
    }

    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => cb(data));
        }
    }

    getChannels() {
        return [...this.channels];
    }

    getConnectedGamepads() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        return gamepads.filter(gp => gp !== null);
    }

    setActiveGamepad(index) {
        if (this.gamepads.has(index)) {
            this.activeGamepad = index;
        }
    }

    getActiveGamepad() {
        if (this.activeGamepad === null) return null;
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        return gamepads[this.activeGamepad];
    }

    setAxisMapping(axisIndex, channelIndex, invert = false) {
        this.mapping.axes[axisIndex] = { ch: channelIndex, invert };
    }

    setButtonMapping(buttonIndex, channelIndex, toggle = true, threePos = false) {
        this.mapping.buttons[buttonIndex] = { ch: channelIndex, toggle, threePos };
    }

    reset() {
        this.channels.fill(CRSF.CRSF_CHANNEL_VALUE_MID);
        this.channels[2] = CRSF.CRSF_CHANNEL_VALUE_MIN;
        this.buttonStates = {};
        this.threePosStates = {};
        this.lastButtonValues = {};
    }
}

export let gamepadManagerInstance = null;

export function getGamepadManager() {
    if (!gamepadManagerInstance) {
        gamepadManagerInstance = new GamepadManager();
    }
    return gamepadManagerInstance;
}
