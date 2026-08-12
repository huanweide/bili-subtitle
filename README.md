<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/bili-subtitle)](LICENSE)
[![CI](https://github.com/huanweide/bili-subtitle/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/bili-subtitle/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/huanweide/bili-subtitle)](https://github.com/huanweide/bili-subtitle/stargazers)
<!-- /badges -->

# B站字幕一键提取 · 篡改猴插件（极速版 v6.1）

> 姊妹项目：本插件是「浏览器一键提取」形态（零配置、无需 API Key）。如果你需要**命令行批量下载**，或在**无字幕时用 AI 语音转文字**生成字幕，请用 [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor)（纯 Python 命令行版）。

打开 B站视频 → 点一下 🎬 → 秒级获取字幕 → 一键复制 / 下载 TXT·SRT。没有字幕也能一键复制视频标题与简介。

## 特性

- **极速获取**：直接调用 B站公开 API 拉取字幕，无需 Cookie，纯本地运行，秒级返回。
- **智能选源**：自动优先中文 AI 字幕（`ai-zh`），其次中文 CC（`zh-CN`），再英语等；也可手动切换所有可用语言。
- **结果缓存**：同一视频同一语言不重复请求，二次点击瞬时出结果。
- **一键复制**：全文复制，带成功提示。
- **下载 TXT / SRT**：TXT 为纯文字稿；SRT 带标准时间戳，可导入剪映、播放器等。
- **极简面板**：悬浮按钮 + 可展开面板，显示视频标题、语言、字数、进度。
- **自动识别**：打开视频自动识别，切换视频自动重置；支持番剧（`/bangumi/play/`）。
- **零依赖**：单文件 `.user.js`，无需任何 API Key，无需后端。
- **长视频完整**：长视频的 AI 字幕若被分段，自动合并全部片段并按时间排序去重，不再只拿到前面一小段。
- **无字幕也能复制**：没有字幕时，复制按钮依旧可用，一键复制视频标题、UP主与简介。

## 安装

以 Edge 为例（Chrome / Firefox 装 Tampermonkey 同理）：

1. 安装 [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)。
2. 点击 `bili-subtitle.user.js` 安装（Tampermonkey 会弹出安装页 → 点「安装」）。
3. 打开任意 B站视频页，右下角出现 🎬 按钮。

## 使用

| 操作 | 结果 |
|------|------|
| 点 🎬 按钮 | 展开面板 |
| 点「⚡ 获取字幕」 | 秒级拉取字幕，面板显示文字稿 |
| 切换「语言」下拉 | 在 AI 中文 / CC / 英语 等可用字幕间切换 |
| 点「📋 复制」 | 全文复制到剪贴板 |
| 点「⬇ TXT」 | 下载纯文字稿 |
| 点「⬇ SRT」 | 下载带时间戳字幕 |

没有字幕的视频也会显示提示，但**复制按钮依旧可用**，可一键复制视频标题与简介；网络异常会提示失败并可重试。

## 原理

```
B站视频页 → 读取 cid → 查字幕列表(API) → 选语言 → 下载字幕 JSON → 提取文本/时间戳 → 复制/下载
```

全程 API 直取，不模拟点击、不依赖页面选择器，稳定且快。

## 文件

| 文件 | 说明 |
|------|------|
| `bili-subtitle.user.js` | 篡改猴插件（安装这个） |
| `test_logic.js` | 核心逻辑单元测试（Node 运行，验证选源/时间戳/格式化） |
| `bili-asr.py` | 与本插件无关，可忽略（独立音频转字幕工具，备用） |

## 常见问题

- **打开视频没看到按钮？** 确认 Tampermonkey 已启用、脚本已安装且作用于 bilibili.com。
- **提示无字幕？** 该视频 B站未生成 AI 字幕，也无 UP 主上传的 CC 字幕，确实没有可提取的字幕文本；但你仍可一键复制视频标题与简介留存。
- **番剧能用吗？** 支持（`/bangumi/play/` 页面同样出现按钮）。

## 许可证

MIT License。
