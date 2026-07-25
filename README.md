<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/bili-subtitle)](LICENSE)
[![CI](https://github.com/huanweide/bili-subtitle/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/bili-subtitle/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/huanweide/bili-subtitle)](https://github.com/huanweide/bili-subtitle/stargazers)
<!-- /badges -->

﻿# B站字幕一键提取 · 篡改猴插件

打开B站视频 → 点一下粉色按钮 → 字幕文字直接复制。

## 安装

1. Edge 装 [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
2. 点此安装脚本 → [bili-subtitle.user.js](https://github.com/huanweide/bili-subtitle/raw/main/bili-subtitle.user.js)
3. Tampermonkey 会自动弹出安装页面 → 点「安装」

## 使用

打开任意B站视频页，右下角出现 🎬 按钮：

| 场景 | 显示 |
|------|------|
| 查询中 | `⏳ 查询中...` |
| 有字幕 | `✅ 成功 · 1234字` → 出现 📋 一键复制 |
| 无字幕 | `⚠️ 该视频无字幕` |
| 失败 | `❌ 提取失败` |

点「📋 一键复制」→ 全部字幕文字到剪贴板。

换视频自动重置。

## 原理

```
B站API → 查cid → 查字幕 → 有 → 下载JSON字幕 → 提取纯文本 → 复制
                      → 无 → 提示"无字幕"
```

## 文件

| 文件 | 说明 |
|------|------|
| `bili-subtitle.user.js` | 篡改猴插件（安装这个就行） |
| `bili-asr.py` | Python命令行版（备用，音频转字幕） |
## 项目合并说明

本仓库已合并并取代 [`bili-subtitle-extractor`](https://github.com/huanweide/bili-subtitle-extractor)（该仓库已归档）。后续维护统一在此进行。
