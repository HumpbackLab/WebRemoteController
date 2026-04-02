# ELRS Web Remote Control

一个在浏览器中运行的 ExpressLRS 遥控器，通过 Web Serial API 与 ELRS TX 模块通信。

## 功能特性

- **虚拟摇杆**: Canvas 绘制的双摇杆 UI，支持触摸和鼠标
- **物理手柄支持**: 使用 Gamepad API 支持连接到电脑的游戏手柄
- **CRSF 协议**: 完整的 CRSF 协议实现，基于官方 ExpressLRS 代码
- **回传数据解析**: 支持链路统计、电池、GPS、姿态、飞行模式等回传
- **一键操作**:
  - Bind 模式
  - WiFi 模式
- **16 通道**: 4 主通道 + 12 辅助通道

## 使用方法

### 1. 启动本地服务器

由于浏览器安全限制，需要通过本地服务器访问：

```bash
# 使用 Python
python3 -m http.server 8000

# 或使用 Node.js
npx serve .

# 或使用 VS Code 的 Live Server 扩展
```

### 2. 打开浏览器

访问 `http://localhost:8000`（使用 Chrome、Edge 或 Opera 浏览器，需要支持 Web Serial API）

### 3. 连接 ELRS TX

1. 通过 USB 连接 ELRS TX 模块到电脑
2. 点击 "Connect" 按钮
3. 在弹出的串口选择框中选择你的 ELRS 设备

### 4. 开始使用

- **虚拟摇杆模式**: 使用鼠标或触摸操作屏幕上的摇杆
- **游戏手柄模式**: 连接游戏手柄，选择 "Gamepad" 模式

## 通道映射

### 虚拟摇杆

| 通道 | 功能 | 控制 |
|------|------|------|
| CH1 | Roll | 右摇杆 X |
| CH2 | Pitch | 右摇杆 Y |
| CH3 | Throttle | 左摇杆 Y |
| CH4 | Yaw | 左摇杆 X |
| CH5-CH12 | AUX1-AUX8 | 虚拟开关按钮 |

### 游戏手柄 (Xbox/PS4 布局)

| 控制 | 通道 | 功能 |
|------|------|------|
| 左摇杆 X | CH1 | Roll |
| 左摇杆 Y | CH2 | Pitch |
| 右摇杆 X | CH4 | Yaw |
| 右摇杆 Y | CH3 | Throttle |
| A | CH5 | AUX1 (Toggle) |
| B | CH6 | AUX2 (3-position) |
| X | CH7 | AUX3 (Toggle) |
| Y | CH8 | AUX4 (Toggle) |
| LB | CH9 | AUX5 (Toggle) |
| RB | CH10 | AUX6 (Toggle) |
| LT | CH11 | AUX7 (Toggle) |
| RT | CH12 | AUX8 (Toggle) |
| Select | CH13 | AUX9 (Toggle) |
| Start | CH14 | AUX10 (Toggle) |
| L3 | CH15 | AUX11 (Toggle) |
| R3 | CH16 | AUX12 (Toggle) |

## 技术说明

### CRSF 协议实现

基于 `~/ExpressLRS/src/lib/CrsfProtocol/crsf_protocol.h` 中的官方定义：

- 同步字节: `0xC8`
- CRC8 多项式: `0xD5`
- 通道范围: 172-1811 (对应 987-2012us)
- 16 通道打包为 22 字节 (每通道 11 位)

### 串口配置

- 波特率: 420000 (默认)
- 数据位: 8
- 停止位: 1
- 校验位: 无

## 文件结构

```
web_radiocontroller/
├── index.html          # 主页面
├── css/
│   └── style.css       # 样式文件
├── js/
│   ├── crsf.js         # CRSF 协议编解码
│   ├── elrs.js         # ELRS 通信层
│   ├── joystick.js     # 虚拟摇杆
│   ├── gamepad.js      # 游戏手柄支持
│   └── main.js         # 主控制逻辑
└── README.md
```

## 浏览器兼容性

- Chrome 89+
- Edge 89+
- Opera 76+

需要支持:
- Web Serial API
- Gamepad API
- ES6 Modules

## GitHub Pages 部署

仓库已包含 GitHub Pages 工作流：

- [.github/workflows/deploy-pages.yml](/home/ncer/web_radiocontroller/.github/workflows/deploy-pages.yml)

发布步骤：

1. 将代码推送到 `master` 分支，或在 GitHub Actions 页面手动运行 `Deploy GitHub Pages`
2. 打开仓库 `Settings > Pages`
3. 将 `Source` 设置为 `GitHub Actions`

默认发布地址：

- `https://humpbacklab.github.io/WebRemoteController/`

说明：

- 这是纯静态页面，适合直接部署到 GitHub Pages
- GitHub Pages 提供 HTTPS，满足 Web Serial API 的安全上下文要求
- 功能仍依赖支持 Web Serial API 的桌面浏览器

## 安全警告

这是一个用于航模遥控器的项目。请务必：

1. 在安全的环境中测试
2. 先进行地面测试，确认所有通道正确
3. 确保有安全的油门锁定机制
4. 了解你所在地区的相关法律法规

**使用风险自负！**

## 参考资料

- [ExpressLRS 官方项目](https://github.com/ExpressLRS/ExpressLRS)
- [CRSF 协议文档](https://github.com/crsf-wg/crsf/wiki)
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
