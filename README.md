# WebCodecs MP4 播放器

这是一个基于 WebCodecs API 的高性能 MP4 视频播放器，旨在提供无缝的视频切换体验和广泛的音频格式兼容性。

## 核心特性

- **高性能渲染**: 利用 WebCodecs `VideoDecoder` 在 Worker 线程中解码视频，通过 `OffscreenCanvas` (或 ImageBitmap) 传输到主线程渲染，确主线程流畅。
- **无缝切换**: 采用双播放器（Double Buffering）架构。一个播放器在前台播放时，另一个播放器在后台预加载下一个视频。切换时瞬间完成，无黑屏、无卡顿。
- **混合音频架构**:
  - **视频**: 使用 WebCodecs 解码。
  - **音频**: 使用浏览器原生的 `<audio>` 标签播放。
  - **同步**: 视频渲染循环以 `<audio>` 的 `currentTime` 为主时钟，确保完美的音画同步，同时支持浏览器能播放的所有音频格式（包括 AAC, MP3, PCM A-law/mu-law 等）。
- **精准 Seek**: 实现了基于时间戳过滤的精准 Seek 逻辑，支持跨视频的长距离拖拽。
- **沉浸式体验**: 支持全屏播放，控制栏自动隐藏，视频画面采用 Contain 模式自适应屏幕。

## 技术栈

- **Vue 3**: 响应式 UI 框架。
- **Vite**: 构建工具。
- **WebCodecs API**: `VideoDecoder`, `EncodedVideoChunk`。
- **MP4Box.js**: 用于解封装 MP4 容器，提取视频轨道和采样数据。
- **Tailwind CSS**: 样式库。

## 项目结构

- `src/workers/mp4-worker.js`: Web Worker 脚本，负责下载视频、解封装 MP4、配置和运行 `VideoDecoder`。它将解码后的 `VideoFrame` 发送回主线程。
- `src/composables/usePlayer.js`: 核心播放器逻辑 Hook。管理 `<audio>` 元素、Worker 通信、视频队列 (`videoQueue`) 和渲染循环 (`renderLoop`)。
- `src/components/SinglePlayer.vue`: 单个播放器组件，包含 Canvas 元素。
- `src/App.vue`: 主应用组件，管理播放列表、双播放器状态 (`activePlayerIndex`)、UI 覆盖层（控制栏、全屏等）以及全局 Seek 逻辑。

## 运行

1.  安装依赖:

    ```bash
    pnpm install
    ```

2.  启动开发服务器:
    ```bash
    pnpm dev
    ```

## 注意事项

- **SharedArrayBuffer**: 为了获得最佳性能，建议配置服务器响应头以启用跨域隔离 (Cross-Origin Isolation)，虽然本项目目前的实现已不再强依赖 `SharedArrayBuffer`，但这是 WebCodecs 的最佳实践。
  ```
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  ```
- **浏览器支持**: 需要支持 WebCodecs API 的现代浏览器（Chrome 94+, Edge 94+ 等）。

## 许可证

Apache-2.0
