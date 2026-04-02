/**
 * Virtual Joystick UI Component
 * Canvas-based dual virtual joysticks for touch/mouse input
 */

import * as CRSF from './crsf.js';

export class VirtualJoystick {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container ${containerId} not found`);
        }

        // Channel values (0-2047, centered around 1024)
        this.channels = new Array(16).fill(CRSF.CRSF_CHANNEL_VALUE_MID);

        // Throttle starts at minimum
        this.channels[2] = CRSF.CRSF_CHANNEL_VALUE_MIN;

        // Aux channels default to min or mid as appropriate
        this.channels[4] = CRSF.CRSF_CHANNEL_VALUE_MIN;  // AUX1 - Arm
        this.channels[5] = CRSF.CRSF_CHANNEL_VALUE_MIN;  // AUX2 - Mode
        this.channels[6] = CRSF.CRSF_CHANNEL_VALUE_MID;  // AUX3
        this.channels[7] = CRSF.CRSF_CHANNEL_VALUE_MID;  // AUX4
        this.channels[8] = CRSF.CRSF_CHANNEL_VALUE_MID;  // AUX5
        this.channels[9] = CRSF.CRSF_CHANNEL_VALUE_MID;  // AUX6
        this.channels[10] = CRSF.CRSF_CHANNEL_VALUE_MID; // AUX7
        this.channels[11] = CRSF.CRSF_CHANNEL_VALUE_MID; // AUX8
        this.channels[12] = CRSF.CRSF_CHANNEL_VALUE_MID; // AUX9
        this.channels[13] = CRSF.CRSF_CHANNEL_VALUE_MID; // AUX10
        this.channels[14] = CRSF.CRSF_CHANNEL_VALUE_MID; // AUX11
        this.channels[15] = CRSF.CRSF_CHANNEL_VALUE_MID; // AUX12

        // Joystick state (Canvas: y=0 is top, y=+1 is bottom)
        this.leftStick = { x: 0, y: 1, isDragging: false }; // Throttle starts at bottom (+1)
        this.rightStick = { x: 0, y: 0, isDragging: false };

        // Switch states
        this.switches = new Array(8).fill(false);

        this.callbacks = [];

        this.createUI();
        this.bindEvents();
    }

    createUI() {
        // Main layout
        this.container.innerHTML = `
            <div class="joystick-layout">
                <div class="joystick-section">
                    <canvas id="leftJoystick" class="joystick-canvas"></canvas>
                    <div class="joystick-label">Left Stick (Throttle/Yaw)</div>
                </div>

                <div class="switches-section">
                    <div class="switches-grid">
                        <button class="switch-btn" data-switch="0">ARM</button>
                        <button class="switch-btn" data-switch="1">MODE</button>
                        <button class="switch-btn" data-switch="2">AUX3</button>
                        <button class="switch-btn" data-switch="3">AUX4</button>
                        <button class="switch-btn" data-switch="4">AUX5</button>
                        <button class="switch-btn" data-switch="5">AUX6</button>
                        <button class="switch-btn" data-switch="6">AUX7</button>
                        <button class="switch-btn" data-switch="7">AUX8</button>
                    </div>

                    <div class="channel-monitor">
                        <h4>Channel Output</h4>
                        <div class="channel-bars" id="channelBars"></div>
                    </div>
                </div>

                <div class="joystick-section">
                    <canvas id="rightJoystick" class="joystick-canvas"></canvas>
                    <div class="joystick-label">Right Stick (Roll/Pitch)</div>
                </div>
            </div>
        `;

        this.leftCanvas = document.getElementById('leftJoystick');
        this.rightCanvas = document.getElementById('rightJoystick');

        // Set canvas sizes
        const size = Math.min(200, window.innerWidth / 3);
        [this.leftCanvas, this.rightCanvas].forEach(canvas => {
            canvas.width = size;
            canvas.height = size;
        });

        // Initial draw
        this.drawJoystick(this.leftCanvas, this.leftStick);
        this.drawJoystick(this.rightCanvas, this.rightStick);

        // Create channel bars
        this.createChannelBars();
        this.updateChannelBars();
    }

    createChannelBars() {
        const container = document.getElementById('channelBars');
        container.innerHTML = '';

        for (let i = 0; i < 16; i++) {
            const bar = document.createElement('div');
            bar.className = 'channel-bar-container';
            // Throttle (CH3, index 2) shows MIN, others show MID
            const initialValue = i === 2 ? CRSF.CRSF_CHANNEL_VALUE_MIN : CRSF.CRSF_CHANNEL_VALUE_MID;
            bar.innerHTML = `
                <div class="channel-label">CH${i + 1}</div>
                <div class="channel-bar-wrapper">
                    <div class="channel-bar" id="chBar${i}"></div>
                </div>
                <div class="channel-value" id="chVal${i}">${initialValue}</div>
            `;
            container.appendChild(bar);
        }
    }

    updateChannelBars() {
        for (let i = 0; i < 16; i++) {
            const bar = document.getElementById(`chBar${i}`);
            const val = document.getElementById(`chVal${i}`);
            const value = this.channels[i];
            const percent = ((value - CRSF.CRSF_CHANNEL_VALUE_MIN) /
                            (CRSF.CRSF_CHANNEL_VALUE_MAX - CRSF.CRSF_CHANNEL_VALUE_MIN)) * 100;

            if (bar) {
                bar.style.width = `${percent}%`;
                const center = ((CRSF.CRSF_CHANNEL_VALUE_MID - CRSF.CRSF_CHANNEL_VALUE_MIN) /
                               (CRSF.CRSF_CHANNEL_VALUE_MAX - CRSF.CRSF_CHANNEL_VALUE_MIN)) * 100;
                if (percent >= center) {
                    bar.style.left = `${center}%`;
                    bar.style.width = `${percent - center}%`;
                } else {
                    bar.style.left = `${percent}%`;
                    bar.style.width = `${center - percent}%`;
                }
            }
            if (val) {
                val.textContent = value;
            }
        }
    }

    drawJoystick(canvas, stick) {
        const ctx = canvas.getContext('2d');
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const outerRadius = canvas.width * 0.45;
        const innerRadius = canvas.width * 0.2;
        const deadZone = canvas.width * 0.05;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Outer ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Dead zone circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, deadZone, 0, Math.PI * 2);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Crosshairs
        ctx.beginPath();
        ctx.moveTo(centerX - outerRadius, centerY);
        ctx.lineTo(centerX + outerRadius, centerY);
        ctx.moveTo(centerX, centerY - outerRadius);
        ctx.lineTo(centerX, centerY + outerRadius);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Calculate stick position
        const stickX = centerX + stick.x * (outerRadius - innerRadius);
        const stickY = centerY + stick.y * (outerRadius - innerRadius);

        // Stick
        ctx.beginPath();
        ctx.arc(stickX, stickY, innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = stick.isDragging ? '#4CAF50' : '#2196F3';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Stick center dot
        ctx.beginPath();
        ctx.arc(stickX, stickY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
    }

    bindEvents() {
        // Left joystick (Throttle/Yaw)
        this.bindStickEvents(this.leftCanvas, this.leftStick, (x, y) => {
            // Left stick: Y = Throttle (CH3), X = Yaw (CH4)
            // Note: y inverted - up is positive throttle
            this.channels[2] = this.normalizeThrottleValue(-y); // Throttle (CH3) - special mapping
            this.channels[3] = this.normalizeStickValue(x);  // Yaw (CH4)
            this.notifyChange();
        });

        // Right joystick (Roll/Pitch)
        this.bindStickEvents(this.rightCanvas, this.rightStick, (x, y) => {
            // Right stick: X = Roll (CH1), Y = Pitch (CH2)
            // Note: y inverted - up is positive pitch
            this.channels[0] = this.normalizeStickValue(x);  // Roll (CH1)
            this.channels[1] = this.normalizeStickValue(-y); // Pitch (CH2)
            this.notifyChange();
        });

        // Switch buttons
        this.container.querySelectorAll('.switch-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const switchIndex = parseInt(btn.dataset.switch);
                this.toggleSwitch(switchIndex, btn);
            });
        });
    }

    bindStickEvents(canvas, stick, updateCallback) {
        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left - canvas.width / 2) / (canvas.width * 0.45),
                y: (clientY - rect.top - canvas.height / 2) / (canvas.height * 0.45)
            };
        };

        const clamp = (v) => Math.max(-1, Math.min(1, v));

        const handleStart = (e) => {
            e.preventDefault();
            stick.isDragging = true;
            const pos = getPos(e);
            stick.x = clamp(pos.x);
            stick.y = clamp(pos.y);
            this.drawJoystick(canvas, stick);
            updateCallback(stick.x, stick.y);
        };

        const handleMove = (e) => {
            if (!stick.isDragging) return;
            e.preventDefault();
            const pos = getPos(e);
            stick.x = clamp(pos.x);
            stick.y = clamp(pos.y);
            this.drawJoystick(canvas, stick);
            updateCallback(stick.x, stick.y);
        };

        const handleEnd = (e) => {
            e.preventDefault();
            stick.isDragging = false;
            // Return to center except for left stick Y (throttle)
            if (canvas === this.leftCanvas) {
                stick.x = 0; // Yaw centers
                // Throttle stays
            } else {
                stick.x = 0;
                stick.y = 0;
            }
            this.drawJoystick(canvas, stick);
            updateCallback(stick.x, stick.y);
        };

        canvas.addEventListener('mousedown', handleStart);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);

        canvas.addEventListener('touchstart', handleStart, { passive: false });
        canvas.addEventListener('touchmove', handleMove, { passive: false });
        canvas.addEventListener('touchend', handleEnd, { passive: false });
    }

    normalizeStickValue(v) {
        // v: -1 to 1 - center at MID
        const range = CRSF.CRSF_CHANNEL_VALUE_MAX - CRSF.CRSF_CHANNEL_VALUE_MID;
        return Math.round(CRSF.CRSF_CHANNEL_VALUE_MID + v * range);
    }

    normalizeThrottleValue(v) {
        // v: -1 to 1 - maps MIN (-1) to MAX (+1), no center
        // -1 = MIN (throttle low), +1 = MAX (throttle high)
        const fullRange = CRSF.CRSF_CHANNEL_VALUE_MAX - CRSF.CRSF_CHANNEL_VALUE_MIN;
        return Math.round(CRSF.CRSF_CHANNEL_VALUE_MIN + (v + 1) / 2 * fullRange);
    }

    toggleSwitch(index, btn) {
        this.switches[index] = !this.switches[index];

        // Update button visual
        btn.classList.toggle('active', this.switches[index]);

        // Map to channels (AUX1 starts at CH5, index 4)
        const chIndex = 4 + index;
        if (chIndex < 16) {
            // Toggle between min and max, or 3-position for some
            if (index === 1) {
                // 3-position switch for MODE
                const current = this.channels[chIndex];
                if (current < CRSF.CRSF_CHANNEL_VALUE_MID - 200) {
                    this.channels[chIndex] = CRSF.CRSF_CHANNEL_VALUE_MID;
                } else if (current < CRSF.CRSF_CHANNEL_VALUE_MID + 200) {
                    this.channels[chIndex] = CRSF.CRSF_CHANNEL_VALUE_MAX;
                } else {
                    this.channels[chIndex] = CRSF.CRSF_CHANNEL_VALUE_MIN;
                }
            } else {
                // 2-position
                this.channels[chIndex] = this.switches[index]
                    ? CRSF.CRSF_CHANNEL_VALUE_MAX
                    : CRSF.CRSF_CHANNEL_VALUE_MIN;
            }
        }

        this.notifyChange();
    }

    onChange(callback) {
        this.callbacks.push(callback);
    }

    notifyChange() {
        this.updateChannelBars();
        this.callbacks.forEach(cb => cb(this.channels));
    }

    getChannels() {
        return [...this.channels];
    }

    setChannel(index, value) {
        if (index >= 0 && index < 16) {
            this.channels[index] = Math.max(CRSF.CRSF_CHANNEL_VALUE_MIN,
                                           Math.min(CRSF.CRSF_CHANNEL_VALUE_MAX, value));
            this.notifyChange();
        }
    }

    reset() {
        // Center all sticks except throttle
        this.channels[0] = CRSF.CRSF_CHANNEL_VALUE_MID; // Roll
        this.channels[1] = CRSF.CRSF_CHANNEL_VALUE_MID; // Pitch
        this.channels[2] = CRSF.CRSF_CHANNEL_VALUE_MIN;  // Throttle (min)
        this.channels[3] = CRSF.CRSF_CHANNEL_VALUE_MID; // Yaw

        // Reset sticks UI (Canvas: y=0 is top, y=+1 is bottom)
        this.leftStick.x = 0;
        this.leftStick.y = 1; // Throttle at min (bottom)
        this.rightStick.x = 0;
        this.rightStick.y = 0;

        this.drawJoystick(this.leftCanvas, this.leftStick);
        this.drawJoystick(this.rightCanvas, this.rightStick);

        this.notifyChange();
    }
}
