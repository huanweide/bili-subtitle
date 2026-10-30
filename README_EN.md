**中文** · [README.md](./README.md)

<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/bili-subtitle)](LICENSE)
[![CI](https://github.com/huanweide/bili-subtitle/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/bili-subtitle/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/huanweide/bili-subtitle)](https://github.com/huanweide/bili-subtitle/stargazers)
<!-- /badges -->

> ⚠️ **DEPRECATED**: This project is no longer maintained. Please use [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) instead — it covers **Bilibili / YouTube / any webpage**, grabs subtitles instantly when present and AI-transcribes them when not, still a pure Tampermonkey script with zero backend.

# Bilibili subtitle one-click extractor · Tampermonkey script (v6.1)

> Sister project: this script is the "one-click in-browser" form (zero config, no API key). If you need **batch download from the command line**, or want to **generate subtitles via AI speech-to-text when none exist**, use [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) (pure Python CLI).

Open a Bilibili video → click 🎬 → grab subtitles in seconds → copy / download TXT·SRT in one click. Even with no subtitles, you can still copy the video title and description in one click.

## Features

- **Instant fetch**: calls Bilibili's public subtitle API directly — no cookie, runs locally, returns in seconds.
- **Smart source selection**: auto-prefers Chinese AI subtitles (`ai-zh`), then Chinese CC (`zh-CN`), then English, etc.; you can also switch manually among all available languages.
- **Result cache**: the same video + language isn't requested twice; a second click returns instantly.
- **One-click copy**: copy the full transcript with a success toast.
- **Download TXT / SRT**: TXT is plain text; SRT carries standard timestamps, importable into CapCut, players, etc.
- **Minimal panel**: a floating button + expandable panel showing title, language, word count, progress.
- **Auto-detect**: recognizes videos on open and resets on switch; supports bangumi (`/bangumi/play/`).
- **Zero dependency**: a single `.user.js`, no API key, no backend.
- **Full long videos**: if a long video's AI subtitles are segmented, all segments are merged, time-sorted, and de-duplicated — no more getting only the first snippet.
- **Copy even without subtitles**: when no subtitle exists, the copy button still works to grab the title, UP host, and description.

## Install

Using Edge as an example (Chrome / Firefox with Tampermonkey works the same):

1. Install [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd).
2. Click `bili-subtitle.user.js` to install (Tampermonkey shows an install page → click "Install").
3. Open any Bilibili video page; the 🎬 button appears at the bottom-right.

## Usage

| Action | Result |
|------|------|
| Click 🎬 | Expand the panel |
| Click "⚡ Get subtitles" | Fetch subtitles in seconds; panel shows the transcript |
| Switch the "Language" dropdown | Switch among AI-Chinese / CC / English etc. |
| Click "📋 Copy" | Copy the full transcript to clipboard |
| Click "⬇ TXT" | Download the plain-text transcript |
| Click "⬇ SRT" | Download the timestamped subtitle |

Videos without subtitles still show a hint, but the **copy button keeps working** to grab the title and description; network errors prompt a failure with a retry.

## How it works

```
Bilibili video page → read cid → query subtitle list (API) → pick language → download subtitle JSON → extract text/timestamps → copy/download
```

Pure API access — no click simulation, no reliance on page selectors. Stable and fast.

## Files

| File | Description |
|------|------|
| `bili-subtitle.user.js` | The Tampermonkey script (install this) |
| `test_logic.js` | Unit tests for core logic (run with Node; verifies source selection / timestamps / formatting) |
| `bili-asr.py` | Unrelated to this script, ignore (standalone audio-to-subtitle tool, spare) |

## FAQ

- **No button on the video page?** Make sure Tampermonkey is enabled, the script is installed, and it's allowed on bilibili.com.
- **Says no subtitles?** That video genuinely has no AI subtitles from Bilibili and no UP-host CC subtitles — there's no extractable text; but you can still copy the title and description.
- **Works for bangumi?** Yes (`/bangumi/play/` pages also show the button).

## Migrating to bili-subtitle-universal

This project is deprecated. The successor [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) covers **Bilibili / YouTube / any webpage**, grabs subtitles instantly when present and AI-transcribes when not, and remains a pure Tampermonkey script with zero backend. New users should install the universal version directly.

## Author

Maintained by [huanweide](https://github.com/huanweide) (this project is archived and no longer maintained).

## License

MIT License.
