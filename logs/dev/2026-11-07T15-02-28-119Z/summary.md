# Dev session summary

Started 2026-11-07T15:02:28.119Z, still running or ended abruptly.
648 lines logged, 4 known-noise lines hidden from this summary.

## Bugs (crashes and uncaught errors) (0)

None.


## Errors (7)

- **×1** `1a255ec8` main / uv.sync.service · first 15:02:55.145, last 15:02:55.145
  > UV Error:
- **×1** `1746d768` renderer · first 15:03:15.798, last 15:03:15.798
  > Setup of ai-backend ended without a terminal progress update undefined
  at src/assets/js/store/backendServices.ts:788
- **×1** `e3beac9d` renderer · first 15:03:34.799, last 15:03:34.799
  > Setup of qwen3-tts-backend ended without a terminal progress update undefined
  at src/assets/js/store/backendServices.ts:788
- **×1** `5e6a72a0` renderer · first 15:04:28.464, last 15:04:28.464
  > Setup of llamacpp-backend ended without a terminal progress update undefined
  at src/assets/js/store/backendServices.ts:788
- **×1** `6015fde8` renderer · first 15:05:14.791, last 15:05:14.791
  > Setup of openvino-backend ended without a terminal progress update undefined
  at src/assets/js/store/backendServices.ts:788
- **×1** `99a2de34` renderer · first 15:07:16.793, last 15:07:16.793
  > Setup of comfyui-backend ended without a terminal progress update undefined
  at src/assets/js/store/backendServices.ts:788
- **×1** `438c6667` main / uv.check-details.ComfyUI · first 15:07:23.701, last 15:07:23.701
  > UV Error: error: The environment is outdated; run `uv sync` to update the environment

## Warnings (14)

- **×1** `57d20043` main / backend-version · first 15:02:32.088, last 15:02:32.088
  > Failed to fetch remote versions: 404 Not Found
- **×1** `d4c049ca` main / backend-version · first 15:02:32.090, last 15:02:32.090
  > No version found for ai-backend
- **×1** `01cd8da7` main / backend-version · first 15:02:32.090, last 15:02:32.090
  > No version found for home-agent-backend
- **×1** `7de436e7` main / backend-version · first 15:02:32.090, last 15:02:32.090
  > No version found for qwen3-tts-backend
- **×1** `7c9e1f28` main / backend-version · first 15:02:32.090, last 15:02:32.090
  > No version found for whisper-backend
- **×1** `5d2295f7` main / models · first 15:02:32.097, last 15:02:32.097
  > Failed to fetch remote models: 404 Not Found
- **×1** `4716ba27` main / comfyui-tools · first 15:07:13.980, last 15:07:13.980
  > Repo C:\Users\zsomb\Desktop\ai-playground-fork\AI-Playground\ComfyUI\custom_nodes\ComfyUI-Manager remains in ref 4c50a2bc8b9e684d8a85930567957470b952bebe
- **×1** `4f8b9284` main / comfyui-backend · first 15:07:23.708, last 15:07:23.708
  > Service comfyui-backend venv exists but environment doesn't match expected state. Will attempt startup but recommend reinstallation.
- **×1** `792404d9` main / comfyui-backend · first 15:07:25.853, last 15:07:25.853
  > [WARNING] Could not autodetect AIMDO implementation, assuming Nvidia
- **×1** `fb456562` main / comfyui-backend · first 15:07:26.892, last 15:07:26.892
  > [WARNING] [ComfyUI-Manager] `python -m pip` not available. Falling back to `uv`.
- **×1** `3fd0f920` main / comfyui-backend · first 15:07:44.618, last 15:07:44.618
  > [WARNING] Traceback (most recent call last):
- **×1** `cd10e79f` main / comfyui-backend · first 15:07:44.619, last 15:07:44.619
  > [WARNING] Cannot import C:\Users\zsomb\Desktop\ai-playground-fork\AI-Playground\ComfyUI\comfy_extras\nodes_glsl.py module for custom nodes: No module named 'comfy_angle'
- **×1** `bf9b642c` main / comfyui-backend · first 15:07:50.268, last 15:07:50.268
  > [WARNING] WARNING: some comfy_extras/ nodes did not import correctly. This may be because they are missing some dependencies.
- **×1** `c8ff87bc` main / comfyui-backend · first 15:07:50.269, last 15:07:50.269
  > [WARNING] Please do a: pip install -r requirements.txt
