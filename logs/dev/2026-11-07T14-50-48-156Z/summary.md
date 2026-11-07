# Dev session summary

Started 2026-11-07T14:50:48.156Z, still running or ended abruptly.
323 lines logged, 2 known-noise lines hidden from this summary.

## Bugs (crashes and uncaught errors) (0)

None.


## Errors (1)

- **×3** `438c6667` main / uv.check-details.ComfyUI · first 14:50:48.816, last 14:50:51.870
  > UV Error: error: The environment is outdated; run `uv sync` to update the environment

## Warnings (13)

- **×3** `4f8b9284` main / comfyui-backend · first 14:50:48.819, last 14:50:51.875
  > Service comfyui-backend venv exists but environment doesn't match expected state. Will attempt startup but recommend reinstallation.
- **×1** `2a7d997b` main / compute-metrics · first 14:50:48.488, last 14:50:48.488
  > probe failed: nvidia-smi.exe --query-gpu=index,name,uuid,utilization.gpu,memory.used,memory.total,power.draw,clocks.current.graphics --format=csv,noheader,nounits — exit -1: Process error: spawn nvidia-smi.exe ENOENT
- **×1** `5d2295f7` main / models · first 14:50:49.913, last 14:50:49.913
  > Failed to fetch remote models: 404 Not Found
- **×1** `57d20043` main / backend-version · first 14:50:49.914, last 14:50:49.914
  > Failed to fetch remote versions: 404 Not Found
- **×1** `d4c049ca` main / backend-version · first 14:50:49.917, last 14:50:49.917
  > No version found for ai-backend
- **×1** `01cd8da7` main / backend-version · first 14:50:49.917, last 14:50:49.917
  > No version found for home-agent-backend
- **×1** `7de436e7` main / backend-version · first 14:50:49.917, last 14:50:49.917
  > No version found for qwen3-tts-backend
- **×1** `7c9e1f28` main / backend-version · first 14:50:49.917, last 14:50:49.917
  > No version found for whisper-backend
- **×1** `792404d9` main / comfyui-backend · first 14:50:54.445, last 14:50:54.445
  > [WARNING] Could not autodetect AIMDO implementation, assuming Nvidia
- **×1** `fb456562` main / comfyui-backend · first 14:50:54.781, last 14:50:54.781
  > [WARNING] [ComfyUI-Manager] `python -m pip` not available. Falling back to `uv`.
- **×1** `3fd0f920` main / comfyui-backend · first 14:51:01.113, last 14:51:01.113
  > [WARNING] Traceback (most recent call last):
- **×1** `cd10e79f` main / comfyui-backend · first 14:51:01.113, last 14:51:01.113
  > [WARNING] Cannot import C:\Users\zsomb\Desktop\ai-playground-fork\AI-Playground\ComfyUI\comfy_extras\nodes_glsl.py module for custom nodes: No module named 'comfy_angle'
- **×1** `334316c9` main / comfyui-backend · first 14:51:02.746, last 14:51:02.746
  > [WARNING] 
