#!/usr/bin/env python3

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "data" / "central-bengaluru-commercial-density.json"
OUTPUT = ROOT / "sangeetha-map" / "assets" / "central-commercial-heatmap.png"
WIDTH, HEIGHT = 1800, 1300

with INPUT.open() as source:
    snapshot = json.load(source)

bounds = snapshot["area"]["bounds"]
density = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
for point in snapshot["points"]:
    x = round((point["lng"] - bounds["west"]) / (bounds["east"] - bounds["west"]) * (WIDTH - 1))
    y = round((bounds["north"] - point["lat"]) / (bounds["north"] - bounds["south"]) * (HEIGHT - 1))
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        density[y, x] += float(point.get("weight", 0.7))

# A small blur preserves distinct hotspots; a wider blur joins nearby commercial streets.
surface = (gaussian_filter(density, sigma=30) * 0.72) + (gaussian_filter(density, sigma=78) * 0.28)
floor = np.percentile(surface[surface > 0], 42)
peak = np.percentile(surface[surface > 0], 99.2)
intensity = np.clip((surface - floor) / max(peak - floor, 0.000001), 0, 1)
intensity = np.power(intensity, 0.82)

stops = np.array([
    [18, 177, 73],
    [156, 207, 48],
    [248, 215, 47],
    [245, 120, 29],
    [218, 45, 27],
    [103, 0, 0],
], dtype=np.float32)
scaled = intensity * (len(stops) - 1)
index = np.minimum(scaled.astype(np.int32), len(stops) - 2)
fraction = (scaled - index)[..., None]
rgb = (stops[index] * (1 - fraction)) + (stops[index + 1] * fraction)
alpha = (np.power(intensity, 0.7) * 225).astype(np.uint8)
alpha[intensity < 0.025] = 0
rgba = np.dstack((rgb.astype(np.uint8), alpha))

Image.fromarray(rgba, "RGBA").save(OUTPUT, optimize=True)
print(f"Saved {OUTPUT}")
