#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Copyright 2025-2026 The Alibaba Wan Team Authors. All rights reserved.

"""
check_video_task_status - Query the status and final result of a DashScope API asynchronous video generation task using the task_id.
"""

import os
import sys
import argparse
import requests

# Fix Windows GBK encoding issue for emoji output
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass


def _check_video_task_status(task_id, headers):
    """Check task status until completion"""

    dashscope_base_url = os.environ.get("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/api/v1/")
    check_url = f"{dashscope_base_url}tasks/{task_id}"
    
    check_response = requests.get(check_url, headers=headers)
    if check_response.status_code != 200:
        try:
            error_data = check_response.json()
            error_message = error_data.get(
                "error", f"HTTP {check_response.status_code}")
        except Exception:
            error_message = f"HTTP {check_response.status_code}"
        raise Exception(f"poll Dashscope failed: {error_message}")
    
    check_res = check_response.json()
    status = check_res.get("output", {}).get("task_status")
    
    if status == "SUCCEEDED":
        output = check_res.get("output", {})
        video_url = output.get("video_url", "")
        if video_url:
            return {"status": status, "video_url": video_url, "usage": check_res.get("usage", {})}
        else:
            raise Exception("No video URL found in successful response")
    elif status == "RUNNING":
        return {"status": status, "video_url": "", "usage": {}}
    elif status == "FAILED":
        failed_code = check_res.get("output", {}).get("code", "")
        failed_message = check_res.get("output", {}).get("message", "")
        detail_error = f"Task failed with code: {failed_code}  message: {failed_message}"
        raise Exception(f"Dashscope video generation failed: {detail_error}")
    raise Exception(f"Task polling failed with final status: {status}")


def main():
    parser = argparse.ArgumentParser(description="Query the status and final result of a DashScope API asynchronous video generation task using the task_id")
    parser.add_argument("task_id", type=str, help="The task_id used for querying")
    args = parser.parse_args()
    
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print("❌ Error: DASHSCOPE_API_KEY is not set")
        print("Please set the environment variable:")
        print("  Linux/macOS: export DASHSCOPE_API_KEY='your-api-key'")
        print("  Windows: set DASHSCOPE_API_KEY=your-api-key")
        sys.exit(1)
    
    check_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    try:
        check_rst = _check_video_task_status(task_id=args.task_id, headers=check_headers)
        status = check_rst["status"]
        video_url = check_rst["video_url"]
        usage = check_rst["usage"]
        
        if status == "SUCCEEDED":
            print(f"Video URL: {video_url}")
            if usage:
                print(f"Duration: {usage.get('duration', '?')}s")
                print(f"Resolution: {usage.get('SR', '?')}P")
                print(f"Ratio: {usage.get('ratio', '?')}")
            print("\n🎉 Generation successful!")
        elif status == "RUNNING":
            print(f"\nStill running! This is an asynchronous generation task.")
            print(f"You can later query its status using task_id: {args.task_id}")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  User interrupted the operation")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Program execution failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()