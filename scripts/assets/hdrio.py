"""Float image I/O through Blender's image API (Radiance .hdr in and out).

Run with the Blender Python module available (pip install bpy==4.2.0).
"""
import numpy as np
import bpy


def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Linear Rec.709"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    # Blender stores rows bottom-up; flip so row 0 is the top (zenith).
    return px.reshape(h, w, 4)[::-1, :, :3].copy()


def save(path, rgb, fmt="HDR"):
    h, w, _ = rgb.shape
    img = bpy.data.images.new("out", width=w, height=h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb[::-1]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    img.save()
    bpy.data.images.remove(img)


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def resize(rgb, w, h):
    """Box-filter downscale by an integer factor (equirect-safe)."""
    H, W, _ = rgb.shape
    fx, fy = W // w, H // h
    return rgb[: h * fy, : w * fx].reshape(h, fy, w, fx, 3).mean(axis=(1, 3))
