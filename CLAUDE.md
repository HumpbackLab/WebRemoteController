# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 **ELRS Web 遥控器** 项目 —— 一个在浏览器中运行的 ExpressLRS 遥控器，通过 Web Serial API 与 ELRS TX 模块通信。

## 常用命令

### 启动开发服务器

```bash
# 使用 Python 3
python3 -m http.server 8000

# 或使用 Python 2
python -m SimpleHTTPServer 8000

# 或使用 Node.js
npx serve .
```

### 访问应用

在 Chrome/Edge/Opera 浏览器中打开：`http://localhost:8000`

## 代码架构

### 顶层设计

```
index.html (主页面)
  ↓
js/main.js (主控制逻辑 - 整合各模块)
  ├── js/crsf.js (CRSF协议编解码)
  ├── js/elrs.js (Web Serial通信层)
  ├── js/joystick.js (虚拟摇杆UI)
  └── js/gamepad.js (物理手柄支持)
```

### 关键模块

#### 1. `js/crsf.js` - CRSF 协议核心

**重要常量**（参考 `~/ExpressLRS/src/lib/CrsfProtocol/crsf_protocol.h`）：
- `CRSF_SYNC_BYTE = 0xC8`
- `CRSF_CRC_POLY = 0xD5`
- `CRSF_CHANNEL_VALUE_MIN = 172`, `CRSF_CHANNEL_VALUE_MAX = 1811`

**关键函数**：
- `packChannels(channels[16])` - 16通道×11位打包成22字节
- `unpackChannels(packed)` - 解包
- `buildRCPacket(channels)` - 构建完整RC数据包
- `calcCRC(data)` - CRC8校验（多项式0xD5）
- `parseTelemetry(data)` - 解析回传数据
- `CRSParser` 类 - 流解析状态机

**CRC 计算规则**：从 `type` 字节开始计算（即 packet[2]），不包括最后的 CRC 字节。

#### 2. `js/elrs.js` - 通信层

- `getELRS()` - 获取单例
- `connect(baudRate)` - 连接串口（默认420000）
- `disconnect()` - 断开连接
- `sendRC(channels)` - 发送RC数据
- `enterBindMode()` - 进入绑定模式
- `enterWifiMode()` - 进入WiFi模式
- `startRCSending(channelProvider, rate)` - 开始周期发送
- 事件: `connected`, `disconnected`, `telemetry`, `linkStats`, `error`

#### 3. `js/joystick.js` - 虚拟摇杆

- `VirtualJoystick(containerId)` - 创建摇杆UI
- `getChannels()` - 获取当前16通道值
- `onChange(callback)` - 监听变化
- `setChannel(index, value)` - 设置单通道

#### 4. `js/gamepad.js` - 物理手柄

- `getGamepadManager()` - 获取单例
- `getChannels()` - 获取当前通道值
- `on('connected'|'disconnected'|'change', callback)` - 事件监听

### 通道映射

| 通道 | 功能 | 虚拟摇杆 | 游戏手柄 |
|------|------|----------|----------|
| CH1 | Roll | 右摇杆X | 左摇杆X |
| CH2 | Pitch | 右摇杆Y | 左摇杆Y |
| CH3 | Throttle | 左摇杆Y | 右摇杆Y |
| CH4 | Yaw | 左摇杆X | 右摇杆X |
| CH5-CH16 | AUX1-AUX12 | 虚拟开关 | 手柄按键 |

## 开发注意事项

1. **浏览器兼容性**：仅支持 Chrome/Edge/Opera（需要 Web Serial API）
2. **安全限制**：必须通过 HTTP 服务器访问（不能直接打开 `file://`）
3. **CRSF 协议对齐**：所有协议实现基于官方 ExpressLRS 代码库 `~/ExpressLRS/src/lib/CrsfProtocol/crsf_protocol.h`
4. **CRC 计算**：修改协议代码时，务必保持 CRC 计算逻辑正确
