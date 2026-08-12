#!/usr/bin/env python3
"""
B站字幕提取器 - 音频下载 + ASR 后端
用法:
  python bili-asr.py BVxxxxxx 123456789    # 命令行模式
  python bili-asr.py --server               # 启动本地HTTP服务(端口8765)

依赖: pip install requests
ASR: SiliconFlow SenseVoiceSmall (免费额度)
环境变量: SILICONFLOW_API_KEY
"""

import sys
import json
import os
import time
import re
import argparse
import http.server
import urllib.parse
from aoa import wrap_http, get_breaker, CircuitOpenError

# ========== 配置 ==========
SILICONFLOW_KEY = os.environ.get("SILICONFLOW_API_KEY", "")
ASR_API = "https://api.siliconflow.cn/v1/audio/transcriptions"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# ========== AOA 防护（超时/熔断，单线程 server 防挂死） ==========
SUB_BREAKER = get_breaker("subtitle", 3, 30)   # 字幕抓取熔断
ASR_BREAKER = get_breaker("asr", 3, 60)         # ASR 接口熔断
DL_BREAKER = get_breaker("download", 3, 60)     # 音频下载熔断

# ========== B站API ==========
def get_video_info(bvid, cid=None):
    """获取视频基本信息"""
    import requests
    url = f"https://api.bilibili.com/x/player/v2?bvid={bvid}"
    if cid:
        url += f"&cid={cid}"
    headers = {"Referer": "https://www.bilibili.com/", "User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=15)
    return resp.json()

def get_dash_audio(bvid, cid):
    """获取DASH音频流URL"""
    import requests
    url = f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16&fourk=1"
    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": USER_AGENT,
        "Origin": "https://www.bilibili.com",
    }
    resp = requests.get(url, headers=headers, timeout=15)
    data = resp.json()
    if data["code"] != 0:
        raise Exception(f"获取播放地址失败: {data.get('message','未知错误')}")

    dash = data["data"].get("dash")
    if not dash:
        raise Exception("该视频不支持DASH格式")

    audios = dash.get("audio", [])
    if not audios:
        raise Exception("未找到音频流")

    # 选最低码率（减小文件体积，ASR不需要高音质）
    audio = min(audios, key=lambda a: a.get("bandwidth", 999999))
    print(f"  音频: {audio['codecs']} {audio['bandwidth']//1000}kbps")
    return audio["base_url"], audio["bandwidth"]

def download_audio(audio_url, output_path):
    """下载音频"""
    import requests
    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": USER_AGENT,
        "Range": "bytes=0-",  # 避免部分服务器拒绝
    }

    print(f"  下载中...")
    resp = wrap_http("download", requests.get, DL_BREAKER, audio_url, headers=headers, stream=True, timeout=300)
    total = int(resp.headers.get("content-length", 0))

    downloaded = 0
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded * 100 // total
                print(f"\r  进度: {pct}% ({downloaded//1024}KB/{total//1024}KB)", end="")
    print()
    return output_path

def asr_transcribe(audio_path):
    """SiliconFlow ASR"""
    import requests
    if not SILICONFLOW_KEY:
        raise Exception("请设置环境变量 SILICONFLOW_API_KEY")

    file_size = os.path.getsize(audio_path) / (1024 * 1024)
    print(f"  音频大小: {file_size:.1f}MB")

    if file_size > 100:
        print("  ⚠️ 文件超过100MB，可能需要分段处理")
        print("  建议: 使用 yt-dlp -f worstaudio 获取更小文件")

    with open(audio_path, "rb") as f:
        resp = wrap_http(
            "asr", requests.post, ASR_BREAKER, ASR_API,
            headers={"Authorization": f"Bearer {SILICONFLOW_KEY}"},
            files={"file": ("audio.m4a", f, "audio/mp4")},
            data={"model": "FunAudioLLM/SenseVoiceSmall", "response_format": "json"},
            timeout=600,
        )

    if resp.status_code != 200:
        raise Exception(f"ASR请求失败: HTTP {resp.status_code} {resp.text[:200]}")

    result = resp.json()
    return result.get("text", "")

def text_to_segments(text):
    """将ASR文本按句子拆分为字幕段（简易版）"""
    # 按标点拆分
    sentences = re.split(r'[。！？；\n](?![」』】）\)])', text)
    segments = []
    t = 0.0
    # 中文大致 3字/秒
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        duration = max(1.0, len(s) / 3.0)
        segments.append({
            "from": t,
            "to": t + duration,
            "content": s
        })
        t += duration
    return segments

def segments_to_srt(segments):
    """转SRT格式"""
    srt = ""
    for i, seg in enumerate(segments):
        srt += f"{i+1}\n"
        srt += f"{fmt_time(seg['from'])} --> {fmt_time(seg['to'])}\n"
        srt += f"{seg['content']}\n\n"
    return srt

def fmt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ========== 主流程 ==========
def process_video(bvid, cid):
    print(f"🎬 B站字幕提取: {bvid} (cid={cid})")
    print()

    # 1. 检查是否有官方字幕
    print("🔍 查询字幕...")
    info = get_video_info(bvid, cid)
    if info["code"] == 0:
        subtitle = info["data"].get("subtitle")
        if subtitle and subtitle.get("subtitles"):
            sub_url = subtitle["subtitles"][0]["subtitle_url"]
            if not sub_url.startswith("http"):
                sub_url = "https:" + sub_url
            print(f"✅ 找到官方字幕！正在下载...")
            import requests
            sub_data = wrap_http("subtitle", requests.get, SUB_BREAKER, sub_url, headers={"Referer":"https://www.bilibili.com/"}, timeout=15).json()
            srt = segments_to_srt(sub_data["body"])
            out = f"{bvid}_sub.srt"
            with open(out, "w", encoding="utf-8") as f:
                f.write(srt)
            print(f"✅ 字幕已保存: {out}")
            return

    print("⚠️ 无官方字幕，开始ASR流程...")

    # 2. 获取DASH音频
    print("🎵 获取音频流...")
    audio_url, bandwidth = get_dash_audio(bvid, cid)

    # 3. 下载音频
    audio_path = f"{bvid}_audio.m4a"
    download_audio(audio_url, audio_path)
    print(f"✅ 音频已保存: {audio_path}")

    # 4. ASR识别
    print("🎤 ASR识别中...")
    if not SILICONFLOW_KEY:
        print("❌ 未设置 SILICONFLOW_API_KEY 环境变量")
        print("   获取免费Key: https://cloud.siliconflow.cn/")
        return

    text = asr_transcribe(audio_path)
    if not text:
        print("⚠️ ASR返回空文本")
        return

    print(f"📝 识别完成，{len(text)} 字符")

    # 5. 生成字幕
    segments = text_to_segments(text)
    srt = segments_to_srt(segments)
    out = f"{bvid}_asr.srt"
    with open(out, "w", encoding="utf-8") as f:
        f.write(srt)
    print(f"✅ 字幕已保存: {out}")

    # 清理音频（可选）
    os.remove(audio_path)
    print("🗑️ 临时音频已删除")


# ========== HTTP服务 ==========
class ASRHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/asr":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            bvid = data.get("bvid")
            cid = data.get("cid")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            try:
                info = get_video_info(bvid, cid)
                if info["code"] == 0:
                    subtitle = info["data"].get("subtitle")
                    if subtitle and subtitle.get("subtitles"):
                        import requests
                        sub_url = subtitle["subtitles"][0]["subtitle_url"]
                        if not sub_url.startswith("http"):
                            sub_url = "https:" + sub_url
                        sub_data = wrap_http("subtitle", requests.get, SUB_BREAKER, sub_url, headers={"Referer":"https://www.bilibili.com/"}, timeout=15).json()
                        resp = {"success": True, "segments": sub_data["body"], "source": "official"}
                        self.wfile.write(json.dumps(resp, ensure_ascii=False).encode())
                        return

                audio_url, _ = get_dash_audio(bvid, cid)
                audio_path = f"/tmp/{bvid}_audio.m4a"
                download_audio(audio_url, audio_path)
                text = asr_transcribe(audio_path)
                segments = text_to_segments(text)
                os.remove(audio_path)
                resp = {"success": True, "segments": segments, "source": "asr"}
                self.wfile.write(json.dumps(resp, ensure_ascii=False).encode())
            except Exception as e:
                resp = {"success": False, "error": str(e)}
                self.wfile.write(json.dumps(resp, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"  [{args[0]}] {args[1]} {args[2]}")


# ========== 入口 ==========
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="B站字幕提取器")
    parser.add_argument("bvid", nargs="?", help="视频BV号")
    parser.add_argument("cid", nargs="?", type=int, help="分P的cid")
    parser.add_argument("--server", action="store_true", help="启动本地HTTP服务")
    args = parser.parse_args()

    if args.server:
        port = 8765
        server = http.server.HTTPServer(("127.0.0.1", port), ASRHandler)
        print(f"🚀 B站ASR服务已启动: http://localhost:{port}")
        print(f"   篡改猴插件会自动连接此服务")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 服务已停止")
    elif args.bvid and args.cid:
        process_video(args.bvid, args.cid)
    else:
        print("用法:")
        print("  python bili-asr.py BVxxxxxx 123456789")
        print("  python bili-asr.py --server")
