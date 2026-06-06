# B站字幕一键提取 · 篡改猴插件

打开B站视频 → 点一下粉色按钮 → 自动出SRT字幕文件。

**有官方字幕**: 秒下  
**无字幕**: 自动下载音频 → AI语音识别 → 生成SRT

## 安装（30秒）

1. Edge 浏览器安装 [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
2. 打开 `bili-subtitle.user.js` → 全选复制
3. Tampermonkey 图标 → 创建新脚本 → 粘贴 → `Ctrl+S` 保存
4. 打开任意B站视频，右下角出现 🎬 按钮

## 使用

| 场景 | 操作 |
|------|------|
| 有官方字幕 | 点 🎬 → 直接下载 SRT |
| 无字幕 | 点 🎬 → 首次提示输入 API Key → 自动下载音频 → AI听写 → 出SRT |

**API Key 获取（免费）：**
[cloud.siliconflow.cn](https://cloud.siliconflow.cn/) → 注册 → API密钥 → 新建 → 复制 `sk-xxx` → 粘贴到插件弹窗

免费额度：100小时/月，够用。

## 原理

```
B站API → 查字幕 → 有 → 直接下SRT
                → 无 → DASH音频 → SiliconFlow SenseVoice → 分段 → SRT
```

全程在浏览器内完成，不经过任何第三方服务器。API Key 存在浏览器本地，不上传。

## 文件

| 文件 | 说明 |
|------|------|
| `bili-subtitle.user.js` | 篡改猴插件（主文件，全功能） |
| `bili-asr.py` | Python命令行版（备用，超大视频用） |
