# -*- coding: utf-8 -*-
"""Картинка предмета: скачать, вырезать фон, вписать в квадрат 640.

   Предмет занимает кадр почти целиком — ребёнок смотрит на планшет с
   полуметра, и мелкий предмет в большом поле он просто не разберёт.
   Поля оставляем 4%: без них вырезка липнет к краю карточки.

       python tools/art.py <id> <url> [--crop x0,y0,x1,y1] [--model NAME]

   Обрезка нужна, когда предмет снят в куче: вырезаем сначала руками тот
   экземпляр, который пойдёт в игру, а уже потом снимаем фон.
"""
import sys, io, os, subprocess, tempfile
import numpy as np
import cv2
from PIL import Image
from rembg import remove, new_session

SIDE, MARGIN = 640, 0.04
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def fetch(url):
    f = tempfile.NamedTemporaryFile(suffix=".img", delete=False); f.close()
    subprocess.run(["curl", "-sL", "-m", "60", "-o", f.name, url], check=True)
    img = Image.open(f.name).convert("RGB")
    os.unlink(f.name)
    return img

def solid(img):
    """Одна связная фигура без осколков и без дырок внутри."""
    a = np.asarray(img.getchannel("A"))
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > 40).astype(np.uint8), 8)
    if n > 1:
        big = st[1:, cv2.CC_STAT_AREA].max()
        keep = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > big * 0.12])
        a = np.where(keep, a, 0).astype(np.uint8)
    h, w = a.shape
    edge = cv2.copyMakeBorder((a > 40).astype(np.uint8) * 255, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(edge, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 128)
    a = np.where(edge[1:-1, 1:-1] == 0, 255, a).astype(np.uint8)
    return Image.fromarray(np.dstack([np.asarray(img.convert("RGB")), a]), "RGBA")

def make(name, url, crop=None, model="isnet-general-use"):
    src = fetch(url)
    if crop: src = src.crop(crop)
    cut = solid(remove(src, session=new_session(model)).convert("RGBA"))
    # рамку считаем по заметным точкам: слабый ореол вокруг выреза иначе
    # съедает треть кадра, и предмет выходит мелким
    bb = cut.getchannel("A").point(lambda v: 255 if v > 25 else 0).getbbox()
    if not bb: raise SystemExit("%s: вырезать нечего" % name)
    cut = cut.crop(bb)
    box = int(SIDE * (1 - 2 * MARGIN))
    s = min(box / cut.width, box / cut.height)
    small = cut.resize((max(1, int(cut.width * s)), max(1, int(cut.height * s))), Image.LANCZOS)
    frame = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
    frame.paste(small, ((SIDE - small.width) // 2, (SIDE - small.height) // 2), small)
    out = os.path.join(ROOT, "art", name + ".png")
    frame.save(out)
    print("%-10s %dx%d -> %d%% кадра" % (name, small.width, small.height,
                                         max(small.width, small.height) * 100 // SIDE), flush=True)

if __name__ == "__main__":
    a = sys.argv[1:]
    crop = model = None
    if "--crop" in a:
        i = a.index("--crop"); crop = tuple(int(v) for v in a[i+1].split(",")); del a[i:i+2]
    if "--model" in a:
        i = a.index("--model"); model = a[i+1]; del a[i:i+2]
    make(a[0], a[1], crop, model or "isnet-general-use")
