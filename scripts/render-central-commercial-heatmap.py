#!/usr/bin/env python3

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "data" / "central-bengaluru-commercial-density.json"
OUTPUT = ROOT / "sangeetha-map" / "assets" / "central-commercial-heatmap.png"
# Build the heat field at a deliberately coarse resolution, then scale it up.
# This makes nearby commercial clusters merge into one organic city patch instead
# of rendering as a collection of point-sized circles.
FIELD_WIDTH, FIELD_HEIGHT = 450, 325
WIDTH, HEIGHT = 1800, 1300

with INPUT.open() as source:
    snapshot = json.load(source)

bounds = snapshot["area"]["bounds"]
density = np.zeros((FIELD_HEIGHT, FIELD_WIDTH), dtype=np.float32)
for point in snapshot["points"]:
    x = round((point["lng"] - bounds["west"]) / (bounds["east"] - bounds["west"]) * (FIELD_WIDTH - 1))
    y = round((bounds["north"] - point["lat"]) / (bounds["north"] - bounds["south"]) * (FIELD_HEIGHT - 1))
    if 0 <= x < FIELD_WIDTH and 0 <= y < FIELD_HEIGHT:
        density[y, x] += float(point.get("weight", 0.7))

# Multiple blur ranges turn individual buildings into continuous, irregular
# commercial zones. The widest field is intentionally subtle: it connects
# nearby activity without flooding the entire map with colour.
surface = (
    gaussian_filter(density, sigma=8) * 0.42
    + gaussian_filter(density, sigma=20) * 0.38
    + gaussian_filter(density, sigma=38) * 0.20
)
floor = np.percentile(surface[surface > 0], 68)
peak = np.percentile(surface[surface > 0], 99.35)
intensity = np.clip((surface - floor) / max(peak - floor, 0.000001), 0, 1)
intensity = np.power(intensity, 0.72)

stops = np.array([
    [87, 64, 214],   # violet outer contour
    [52, 166, 241],  # cyan
    [24, 214, 167],  # green / teal
    [173, 232, 56],  # lime
    [255, 218, 23],  # yellow
    [255, 111, 0],   # orange
    [240, 42, 20],   # red
    [120, 0, 0],     # dark red core
], dtype=np.float32)
scaled = intensity * (len(stops) - 1)
index = np.minimum(scaled.astype(np.int32), len(stops) - 2)
fraction = (scaled - index)[..., None]
rgb = (stops[index] * (1 - fraction)) + (stops[index + 1] * fraction)
alpha_mask = np.clip((intensity - 0.075) / 0.925, 0, 1)
alpha = (np.power(alpha_mask, 0.75) * 232).astype(np.uint8)
rgba = np.dstack((rgb.astype(np.uint8), alpha))

field = Image.fromarray(rgba, "RGBA")
field.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS).save(OUTPUT, optimize=True)
print(f"Saved {OUTPUT}")
