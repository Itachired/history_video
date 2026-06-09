# Chat2Cartoon Interface Test Plan

## Scope

This plan validates the external services used by the local Chat2Cartoon demo:

- Ark chat model for script/storyboard/text phases.
- Ark image generation model for role images and first-frame images.
- Ark content generation video task API for image-to-video tasks.
- VideoPilot V2 API as an alternative video-generation path.
- TOS credentials and bucket availability for audio/film upload.
- TTS credentials for audio generation, when credentials are provided.

## Tested Configuration

```env
LLM_ENDPOINT_ID=doubao-seed-1-6-250615
T2V_ENDPOINT_ID=doubao-seedream-5-0-260128
CGT_ENDPOINT_ID=doubao-seedance-2-0-fast-260128
VIDEOPILOT_BASE_URL=https://prompt-pilot.cn-beijing.volces.com/video-pilot/v2
VIDEOPILOT_WORKSPACE_ID=vp_v2
```

Sensitive credentials are intentionally not recorded in this file.

## Test Matrix

| Area | Interface | Expected result | Current result |
| --- | --- | --- | --- |
| Text | `Ark.chat.completions.create` | Returns short assistant text | Pass |
| Image | `Ark.images.generate` | Returns at least one image URL | Pass |
| Project chat API | `/api/v3/bots/chat/completions` | Returns `phase=...` chunk response | Pass |
| Video SDK | `Ark.content_generation.tasks.create` | Creates video task ID and returns video URL after polling | Pass |
| VideoPilot create | `POST ...?Action=VpV2VideoGeneration` | Returns TaskId | Pass |
| VideoPilot get | `POST ...?Action=VpV2Get` | Returns task status | Pass |
| TOS | `list_objects` / `put_object` | Bucket is accessible | Blocked: `VIDEO_GEN` / `video_gen` produce TLS hostname mismatch; `video-gen` does not exist; `videogen` exists but AK/SK has no permission |
| TTS | TTS websocket | Generates audio | Not tested: credentials missing |

## Commands

Run these from:

```bash
cd /Users/tangyuanhao/Documents/Codex/历史视频/ai-app-lab/demohouse/chat2cartoon/backend
```

### 1. Compile Backend

```bash
conda run -n video-gen1 python -m compileall -q app index.py
```

### 2. Health Check

```bash
curl -i http://127.0.0.1:8889/v1/ping
```

### 3. Project Chat API Smoke Test

```bash
curl -N \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8889/api/v3/bots/chat/completions \
  -d '{"model":"local-test","messages":[{"role":"user","content":"讲一个非常短的睡前刷牙故事"}]}'
```

### 4. VideoPilot Query Smoke Test

Use a fake task ID to validate endpoint and auth without creating a task:

```bash
python -c '
import os, requests
from dotenv import load_dotenv
load_dotenv("../.env")
headers = {"Content-Type": "application/json", "Authorization": "ArkKey " + os.environ["ARK_API_KEY"]}
r = requests.post(
    os.environ["VIDEOPILOT_BASE_URL"] + "?Action=VpV2Get",
    headers=headers,
    json={"TaskId": "fake-task-id-for-connectivity-test", "WorkspaceId": os.environ["VIDEOPILOT_WORKSPACE_ID"]},
    timeout=30,
)
print(r.status_code, r.text)
'
```

## Current Blockers

1. `doubao-seedance-2-0-fast-260128` was re-tested after model activation and can now create a video task successfully.
   - Test task: `cgt-20260608142909-8cdgk`
   - Final status: `succeeded`
   - Downloaded local test video: `logs/seedance-test-cgt-20260608142909-8cdgk.mp4`
2. `TOS_BUCKET=VIDEO_GEN` is not accessible via the TOS SDK because the virtual-host URL produces a certificate hostname mismatch. This bucket name is not DNS-compatible for SDK access. Use a lowercase DNS-compatible bucket name such as `video-gen`.
3. TTS fields are still placeholders, so audio and final film generation cannot complete yet.

## Recommended Next Tests

After filling `TOS_BUCKET`, upload and sign a tiny test object:

```text
put_object -> pre_signed_url -> curl HEAD signed URL
```

After filling TTS credentials:

```text
one short line -> websocket TTS -> mp3 bytes -> upload to TOS
```

After activating Seedance:

```text
Seedream test image -> Seedance content_generation task -> tasks.get -> video URL
```

Current result: passed.

If choosing VideoPilot instead of Seedance SDK:

```text
VpV2VideoGeneration -> VpV2Get -> adapt backend Video phase to return the expected Chat2Cartoon video schema
```
