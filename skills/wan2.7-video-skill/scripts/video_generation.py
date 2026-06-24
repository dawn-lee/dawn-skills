#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Wan 2.7 Video Generation via DashScope API

Three modes:
  t2v  - Text-to-video
  i2v  - Image-to-video (first frame / first+last frame / with audio)
  r2v  - Video continuation (first clip / first clip + last frame)

Uses the video-synthesis endpoint (wan2.7 only).
"""

import os
import sys
import json
import argparse
import requests
import time

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass


DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"


def _get_base_url():
    url = os.environ.get("DASHSCOPE_BASE_URL", DEFAULT_BASE_URL)
    return url.rstrip("/")


def _poll_task(task_id, headers, interval=15, max_polls=120):
    base = _get_base_url()
    check_url = base + "/tasks/" + task_id
    status = "PENDING"
    for i in range(max_polls):
        print("  [%d/%d] Polling %s, status: %s ..." % (i+1, max_polls, task_id, status))
        time.sleep(interval)
        resp = requests.get(check_url, headers=headers, timeout=30)
        if resp.status_code != 200:
            raise Exception("Poll failed: HTTP %d - %s" % (resp.status_code, resp.text))
        data = resp.json()
        output = data.get("output", {})
        status = output.get("task_status", "UNKNOWN")
        if status == "SUCCEEDED":
            return {"status": "SUCCEEDED", "video_url": output.get("video_url", ""), "usage": data.get("usage", {}), "raw": data}
        elif status == "FAILED":
            raise Exception("Task failed: code=%s message=%s" % (output.get("code",""), output.get("message","")))
        elif status in ("PENDING", "RUNNING"):
            continue
        else:
            raise Exception("Unknown status: %s" % status)
    raise Exception("Timed out after %ds (still %s)" % (max_polls * interval, status))


def download_video(url, output_path):
    print("  Downloading to %s ..." % output_path)
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print("  Done: %s (%.1f MB)" % (output_path, size_mb))


def _submit_task(payload, api_key, model):
    base = _get_base_url()
    api_url = base + "/services/aigc/video-generation/video-synthesis"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + api_key,
        "X-DashScope-Async": "enable",
        "X-DashScope-OssResourceResolve": "enable",
    }
    print("  Submitting task ...")
    resp = requests.post(api_url, headers=headers, json=payload, timeout=30)
    if resp.status_code != 200:
        raise Exception("Submit failed: HTTP %d - %s" % (resp.status_code, resp.text))
    result = resp.json()
    task_id = result.get("output", {}).get("task_id")
    if not task_id:
        raise Exception("No task_id: %s" % json.dumps(result, ensure_ascii=False))
    print("  Task: %s (status: %s)" % (task_id, result.get("output",{}).get("task_status","UNKNOWN")))
    check_headers = {"Authorization": "Bearer " + api_key}
    task_result = _poll_task(task_id, check_headers)
    video_url = task_result.get("video_url", "")
    if video_url:
        return {"success": True, "video_url": video_url, "usage": task_result.get("usage", {})}
    return {"success": True, "raw": task_result.get("raw", {})}


def text_to_video(prompt, model="wan2.7-t2v", resolution="1080P", ratio="16:9",
                  duration=5, negative_prompt="", prompt_extend=True, watermark=False,
                  seed=None, audio_url="", output_dir="."):
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise Exception("DASHSCOPE_API_KEY not set")

    input_block = {"prompt": prompt}
    if negative_prompt:
        input_block["negative_prompt"] = negative_prompt
    if audio_url:
        input_block["audio_url"] = audio_url

    params = {"resolution": resolution, "ratio": ratio, "duration": duration,
              "prompt_extend": prompt_extend, "watermark": watermark}
    if seed is not None:
        params["seed"] = seed

    payload = {"model": model, "input": input_block, "parameters": params}

    print("[T2V] Model: %s" % model)
    print("[T2V] Prompt: %s" % prompt)
    if negative_prompt: print("[T2V] Negative: %s" % negative_prompt)
    if audio_url: print("[T2V] Audio: %s" % audio_url)
    print("[T2V] Resolution: %s, Ratio: %s, Duration: %ds" % (resolution, ratio, duration))

    result = _submit_task(payload, api_key, model)
    if result.get("video_url"):
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "video_%d.mp4" % int(time.time()))
        download_video(result["video_url"], output_path)
        result["local_path"] = output_path
    return result


def image_to_video(first_frame, prompt="", last_frame="", audio_url="",
                   model="wan2.7-i2v-2026-04-25", resolution="720P", duration=5,
                   negative_prompt="", prompt_extend=True, watermark=False,
                   seed=None, output_dir="."):
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise Exception("DASHSCOPE_API_KEY not set")

    media = [{"type": "first_frame", "url": first_frame}]
    if last_frame:
        media.append({"type": "last_frame", "url": last_frame})
    if audio_url:
        media.append({"type": "driving_audio", "url": audio_url})

    input_block = {"media": media}
    if prompt:
        input_block["prompt"] = prompt
    if negative_prompt:
        input_block["negative_prompt"] = negative_prompt

    params = {"resolution": resolution, "duration": duration,
              "prompt_extend": prompt_extend, "watermark": watermark}
    if seed is not None:
        params["seed"] = seed

    payload = {"model": model, "input": input_block, "parameters": params}

    print("[I2V] Model: %s" % model)
    print("[I2V] First frame: %s" % first_frame)
    if last_frame: print("[I2V] Last frame: %s" % last_frame)
    if audio_url: print("[I2V] Audio: %s" % audio_url)
    if prompt: print("[I2V] Prompt: %s" % prompt)
    print("[I2V] Resolution: %s, Duration: %ds" % (resolution, duration))

    result = _submit_task(payload, api_key, model)
    if result.get("video_url"):
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "video_%d.mp4" % int(time.time()))
        download_video(result["video_url"], output_path)
        result["local_path"] = output_path
    return result


def video_continuation(first_clip, last_frame="", prompt="",
                       model="wan2.7-i2v-2026-04-25", resolution="720P", duration=10,
                       prompt_extend=True, watermark=False, seed=None, output_dir="."):
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise Exception("DASHSCOPE_API_KEY not set")

    media = [{"type": "first_clip", "url": first_clip}]
    if last_frame:
        media.append({"type": "last_frame", "url": last_frame})

    input_block = {"media": media}
    if prompt:
        input_block["prompt"] = prompt

    params = {"resolution": resolution, "duration": duration,
              "prompt_extend": prompt_extend, "watermark": watermark}
    if seed is not None:
        params["seed"] = seed

    payload = {"model": model, "input": input_block, "parameters": params}

    print("[R2V] Model: %s" % model)
    print("[R2V] First clip: %s" % first_clip)
    if last_frame: print("[R2V] Last frame: %s" % last_frame)
    if prompt: print("[R2V] Prompt: %s" % prompt)
    print("[R2V] Resolution: %s, Duration: %ds (total)" % (resolution, duration))

    result = _submit_task(payload, api_key, model)
    if result.get("video_url"):
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "video_%d.mp4" % int(time.time()))
        download_video(result["video_url"], output_path)
        result["local_path"] = output_path
    return result


def main():
    parser = argparse.ArgumentParser(description="Wan 2.7 Video Generation (video-synthesis endpoint)")
    parser.add_argument("--mode", "-m", choices=["t2v", "i2v", "r2v"], default="t2v",
                        help="t2v (text-to-video), i2v (image-to-video), r2v (video continuation)")
    parser.add_argument("--prompt", "-p", type=str, default="")
    parser.add_argument("--model", type=str, default="")

    # T2V
    parser.add_argument("--resolution", type=str, default="1080P", help="720P or 1080P")
    parser.add_argument("--ratio", type=str, default="16:9", choices=["16:9","9:16","1:1","4:3","3:4"],
                        help="Aspect ratio (t2v only, i2v follows input image)")
    parser.add_argument("--duration", "-d", type=int, default=5, help="Duration 2-15s")
    parser.add_argument("--negative-prompt", type=str, default="")
    parser.add_argument("--no-prompt-extend", action="store_true")
    parser.add_argument("--watermark", action="store_true")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--audio-url", type=str, default="", help="Audio URL (t2v) or driving audio (i2v)")

    # I2V
    parser.add_argument("--first-frame", type=str, default="", help="First frame image URL")
    parser.add_argument("--last-frame", type=str, default="", help="Last frame image URL (i2v/r2v)")

    # R2V
    parser.add_argument("--first-clip", type=str, default="", help="First video clip URL (r2v)")

    parser.add_argument("--output-dir", "-o", type=str, default=".")
    args = parser.parse_args()

    if not os.environ.get("DASHSCOPE_API_KEY"):
        print("Error: DASHSCOPE_API_KEY not set")
        sys.exit(1)

    common = dict(resolution=args.resolution, duration=args.duration,
                  prompt_extend=not args.no_prompt_extend, watermark=args.watermark,
                  seed=args.seed, output_dir=args.output_dir)

    if args.mode == "t2v":
        if not args.prompt:
            print("Error: --prompt required for t2v"); sys.exit(1)
        if not (2 <= args.duration <= 15):
            print("Error: --duration must be 2-15"); sys.exit(1)
        model = args.model or "wan2.7-t2v"
        result = text_to_video(prompt=args.prompt, model=model, ratio=args.ratio,
                               negative_prompt=args.negative_prompt,
                               audio_url=args.audio_url, **common)

    elif args.mode == "i2v":
        if not args.first_frame:
            print("Error: --first-frame required for i2v"); sys.exit(1)
        model = args.model or "wan2.7-i2v-2026-04-25"
        result = image_to_video(first_frame=args.first_frame, prompt=args.prompt,
                                last_frame=args.last_frame, audio_url=args.audio_url,
                                model=model, negative_prompt=args.negative_prompt, **common)

    elif args.mode == "r2v":
        if not args.first_clip:
            print("Error: --first-clip required for r2v"); sys.exit(1)
        model = args.model or "wan2.7-i2v-2026-04-25"
        result = video_continuation(first_clip=args.first_clip, last_frame=args.last_frame,
                                    prompt=args.prompt, model=model, **common)

    if result.get("success"):
        if result.get("local_path"):
            print("\nDone! Video saved to: %s" % result["local_path"])
        else:
            print("\nDone! Video URL: %s" % result.get("video_url", "N/A"))
        if result.get("usage"):
            u = result["usage"]
            print("  Duration: %ss, Resolution: %sP, Ratio: %s" % (
                u.get("duration","?"), u.get("SR","?"), u.get("ratio","?")))
    else:
        print("\nFailed: %s" % result.get("error","unknown"))
        sys.exit(1)


if __name__ == "__main__":
    main()